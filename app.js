import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, deleteUser } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, serverTimestamp, deleteDoc, collection, query, where, getDocs, onSnapshot, addDoc, orderBy, enableIndexedDbPersistence, increment, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getDatabase, ref as rtdbRef, set as rtdbSet, onValue, onDisconnect, serverTimestamp as rtdbServerTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAQbze_wKkHFdBbWq0FHAgKOiFn07x4OrU",
  authDomain: "airmessage-49c55.firebaseapp.com",
  databaseURL: "https://airmessage-49c55-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "airmessage-49c55",
  storageBucket: "airmessage-49c55.firebasestorage.app",
  messagingSenderId: "697695491479",
  appId: "1:697695491479:web:3860154eae46301451e0d2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

enableIndexedDbPersistence(db).catch(err => console.log("Persistence failed"));

// Глобальные переменные
let currentChatId = null;
let currentOtherId = null;
let currentProfileUserId = null; 
let currentUserData = null; 
let unsubscribeMessages = null;
let unsubscribeChats = null;
let unsubscribeChatHeader = null;
let unsubscribeUserOnline = null;
let currentOnlineStatusText = ''; 
let chatListTimeout = null;
let chatListArrived = false;
const userCache = {}; 

// Хранилище контекста для долгого тапа сообщений
let longPressedMsgId = null;
let longPressedMsgSenderId = null;
let longPressedMsgText = null;
let editingMessageId = null;

const screens = { 
    onboarding: document.getElementById('onboarding-screen'), 
    auth: document.getElementById('auth-screen'), 
    main: document.getElementById('main-screen'), 
    chat: document.getElementById('chat-screen'), 
    profile: document.getElementById('user-profile-screen'),
    alert: document.getElementById('custom-alert') 
};

const gradients = { 
    'sky': 'linear-gradient(135deg, #00c6ff, #0072ff)', 
    'dark': 'linear-gradient(135deg, #434343, #000000)', 
    'neon': 'linear-gradient(135deg, #8E2DE2, #4A00E0)' 
};

function showScreen(screenName) {
    if (screenName === 'main' && screens.chat.classList.contains('active')) {
        screens.chat.classList.remove('active'); 
        screens.main.classList.remove('shifted');
        screens.profile.classList.remove('active');
        return;
    }
    if (screenName === 'chat') {
        screens.main.classList.add('shifted'); 
        screens.chat.classList.add('active');
        screens.profile.classList.remove('active');
        return;
    }
    if (screenName === 'profile') {
        screens.profile.classList.add('active');
        return;
    }
    Object.values(screens).forEach(s => { if(s) { s.classList.remove('active'); s.classList.remove('shifted'); } });
    if(screens[screenName]) screens[screenName].classList.add('active');
}

function formatTime(date) {
    if (!date) return '';
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    if (typeof value.toDate === 'function') return value.toDate();
    return null;
}

// Обновленная функция для правильных окончаний
function formatLastSeen(date, gender) {
    date = toDate(date);
    let word = 'был(а)';
    if (gender === 'male') word = 'был';
    if (gender === 'female') word = 'была';

    if (!date) return `${word} недавно`;
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    if (diffMins < 1) return `${word} недавно`;
    if (diffMins < 60) return `${word} ${diffMins} мин. назад`;
    if (diffHours < 24) return `${word} ${diffHours} ч. назад`;
    return `${word} ${date.toLocaleDateString('ru-RU')}`;
}

function getContactDisplayName(userId, contactData) {
    if (currentUserData && currentUserData.customNames && currentUserData.customNames[userId]) {
        return currentUserData.customNames[userId];
    }
    return contactData.firstName || contactData.username.replace('@', '');
}

const checkSent = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 5 6 12 3 9"></polyline></svg>`;
const checkRead = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 5 4 12 1 9"></polyline><path d="M16 5l-7 7"></path></svg>`;

function hidePreloader() {
    const preloader = document.getElementById('app-preloader');
    if (!preloader) return;
    preloader.classList.add('hide');
    setTimeout(() => { preloader.style.display = 'none'; }, 500);
}

function setUserOnline(uid) {
    const statusRef = rtdbRef(rtdb, `status/${uid}`);
    onDisconnect(statusRef).set({ isOnline: false, lastSeen: rtdbServerTimestamp() });
    return rtdbSet(statusRef, { isOnline: true, lastSeen: rtdbServerTimestamp() });
}

function setUserOffline(uid) {
    return rtdbSet(rtdbRef(rtdb, `status/${uid}`), { isOnline: false, lastSeen: rtdbServerTimestamp() });
}

function startChatListTimeout() {
    chatListArrived = false;
    clearTimeout(chatListTimeout);
    chatListTimeout = setTimeout(() => {
        if (!chatListArrived && auth.currentUser) {
            showCustomAlert('Связь с сервером нестабильна. Попробуйте отключить VPN или проверить интернет 🛜');
        }
    }, 7000);
}

function markChatListArrived() {
    chatListArrived = true;
    clearTimeout(chatListTimeout);
}

// Онбординг
const deviceInstruction = document.getElementById('device-instruction');
const ua = navigator.userAgent;
if (/android/i.test(ua)) deviceInstruction.innerHTML = "Нажмите <b>⋮ (три точки)</b> ➔ <b>На экран «Домой»</b>";
else if (/iPad|iPhone|iPod/.test(ua)) deviceInstruction.innerHTML = "Нажмите <b>Поделиться</b> ➔ <b>На экран «Домой»</b>";
else deviceInstruction.innerHTML = "Нажмите кнопку установки в адресной строке браузера.";
document.getElementById('btn-onboarding-done').onclick = () => showScreen('auth');

function showCustomAlert(msg, isConfirm = false) {
    return new Promise((res) => {
        document.getElementById('alert-text').innerText = msg; screens.alert.classList.add('active');
        document.getElementById('btn-alert-cancel').classList.toggle('hidden', !isConfirm);
        document.getElementById('btn-alert-ok').onclick = () => { screens.alert.classList.remove('active'); res(true); };
        document.getElementById('btn-alert-cancel').onclick = () => { screens.alert.classList.remove('active'); res(false); };
    });
}

// Регистрация / Авторизация (Логика UI)
let isLoginMode = true; let selectedColor = 'sky'; let isCustomColor = false; let registerStep = 1;
const ui = { 
    tabLogin: document.getElementById('tab-login'), 
    tabRegister: document.getElementById('tab-register'), 
    btnLogin: document.getElementById('btn-login'), 
    authForm: document.querySelector('.auth-form'),
    credentialsStep: document.getElementById('auth-credentials-step'),
    passwordConfirm: document.getElementById('auth-password-confirm'),
    avatarSetup: document.getElementById('avatar-setup'), 
    regEmoji: document.getElementById('reg-emoji'), 
    colorDots: document.querySelectorAll('#auth-screen .color-dot'), 
    colorPicker: document.getElementById('custom-color-picker'),
    extraFields: document.getElementById('register-extra-fields'),
    registerNav: document.getElementById('register-nav'),
    btnPrev: document.getElementById('btn-register-prev'),
    btnNext: document.getElementById('btn-register-next'),
    wizardDots: document.querySelectorAll('.wizard-dot')
};

function updatePreview(colorValue, isCustom) { 
    if (isCustom) ui.regEmoji.style.background = colorValue; 
    else ui.regEmoji.style.background = gradients[colorValue]; 
}

ui.colorDots.forEach(dot => { 
    dot.addEventListener('click', (e) => { 
        if (e.target.id === 'custom-color-picker') return; 
        ui.colorDots.forEach(d => d.classList.remove('active')); 
        dot.classList.add('active'); 
        if (dot.classList.contains('rainbow-dot')) { isCustomColor = true; selectedColor = ui.colorPicker.value; } 
        else { isCustomColor = false; selectedColor = dot.dataset.color; } 
        updatePreview(selectedColor, isCustomColor); 
    }); 
});

ui.colorPicker.addEventListener('input', (e) => { 
    selectedColor = e.target.value; isCustomColor = true; 
    ui.colorDots.forEach(d => d.classList.remove('active')); 
    document.querySelector('#auth-screen .rainbow-dot').classList.add('active'); 
    updatePreview(selectedColor, true); 
});

function setAuthMode(loginMode) {
    isLoginMode = loginMode;
    ui.tabLogin.classList.toggle('active', loginMode);
    ui.tabRegister.classList.toggle('active', !loginMode);
    ui.authForm.classList.toggle('register-mode', !loginMode);
    ui.extraFields.classList.toggle('hidden', loginMode);
    ui.registerNav.classList.toggle('hidden', loginMode);
    ui.passwordConfirm.classList.toggle('hidden', loginMode);
    if (loginMode) {
        ui.credentialsStep.classList.add('active');
        ui.btnLogin.classList.remove('hidden');
        ui.btnLogin.innerText = 'Войти в аккаунт';
    } else {
        registerStep = 1;
        updateRegisterStep();
    }
}

function updateRegisterStep() {
    document.querySelectorAll('.auth-form .register-step').forEach(step => {
        step.classList.toggle('active', Number(step.dataset.step) === registerStep);
    });
    ui.wizardDots.forEach(dot => dot.classList.toggle('active', Number(dot.dataset.step) === registerStep));
    ui.btnPrev.classList.toggle('hidden', registerStep === 1);
    ui.btnNext.classList.toggle('hidden', registerStep === 3);
    ui.btnLogin.classList.toggle('hidden', registerStep !== 3);
    ui.btnLogin.innerText = 'Создать аккаунт';
}

function validateRegisterStep(step) {
    const user = document.getElementById('auth-username').value.trim().replace('@', '');
    const pass = document.getElementById('auth-password').value.trim();
    const passConfirm = ui.passwordConfirm.value.trim();
    const fName = document.getElementById('reg-first-name').value.trim();
    const lName = document.getElementById('reg-last-name').value.trim();
    const usernameRegex = /^[a-zA-Z0-9]+$/;

    if (step === 1) {
        if (user.length < 3 || user.length > 20 || pass.length < 6) {
            showCustomAlert('Ник от 3 до 20 символов, пароль от 6');
            return false;
        }
        if (!usernameRegex.test(user)) {
            showCustomAlert('Ник должен состоять только из английских букв и цифр!');
            return false;
        }
        if (pass !== passConfirm) {
            showCustomAlert('Пароли не совпадают.');
            return false;
        }
    }

    if (step === 2) {
        if (!fName || !lName) {
            showCustomAlert('Заполните Имя и Фамилию!');
            return false;
        }
        if (fName.length > 15 || lName.length > 15) {
            showCustomAlert('Имя и фамилия не должны быть длиннее 15 символов!');
            return false;
        }
    }

    return true;
}

ui.tabLogin.onclick = () => setAuthMode(true);
ui.tabRegister.onclick = () => setAuthMode(false);
ui.btnPrev.onclick = () => { if (registerStep > 1) { registerStep--; updateRegisterStep(); } };
ui.btnNext.onclick = () => {
    if (!validateRegisterStep(registerStep)) return;
    if (registerStep < 3) { registerStep++; updateRegisterStep(); }
};

// Сабмит авторизации
ui.btnLogin.addEventListener('click', async () => {
    const user = document.getElementById('auth-username').value.trim().replace('@', ''); 
    const pass = document.getElementById('auth-password').value.trim(); 
    const passConfirm = ui.passwordConfirm.value.trim();
    const emoji = ui.regEmoji.value.trim();
    
    const fName = document.getElementById('reg-first-name').value.trim();
    const lName = document.getElementById('reg-last-name').value.trim();
    const dobVal = document.getElementById('reg-dob').value;
    const genVal = document.getElementById('reg-gender').value;
    const privVal = document.getElementById('reg-privacy').value;

    if (user.length < 3 || user.length > 20 || pass.length < 6) return showCustomAlert('Ник от 3 до 20 символов, пароль от 6');
    
    if (!isLoginMode) {
        const usernameRegex = /^[a-zA-Z0-9]+$/;
        if (!usernameRegex.test(user)) return showCustomAlert('Ник должен состоять только из английских букв и цифр!');
        if (pass !== passConfirm) return showCustomAlert('Пароли не совпадают.');
        if (!fName || !lName) return showCustomAlert('Заполните Имя и Фамилию!');
        if (fName.length > 15 || lName.length > 15) return showCustomAlert('Имя и фамилия не должны быть длиннее 15 символов!');
        if (!emoji) return showCustomAlert('Выберите эмодзи для аватарки!');
    }

    try {
        ui.btnLogin.disabled = true; ui.btnLogin.innerText = 'Загрузка...';
        if (isLoginMode) { 
            await signInWithEmailAndPassword(auth, `${user.toLowerCase()}@air.msg`, pass); 
        } 
        else {
            const cred = await createUserWithEmailAndPassword(auth, `${user.toLowerCase()}@air.msg`, pass);
            await setDoc(doc(db, 'users', cred.user.uid), { 
                username: `@${user}`, 
                usernameLower: `@${user.toLowerCase()}`, 
                firstName: fName,
                lastName: lName,
                firstNameLower: fName.toLowerCase(),
                lastNameLower: lName.toLowerCase(),
                bio: '',
                dob: dobVal,
                gender: genVal,
                isPrivate: privVal === 'private',
                avatarEmoji: emoji, 
                avatarColor: selectedColor, 
                isCustomColor: isCustomColor, 
                createdAt: serverTimestamp(), 
                customNames: {}
            });
        }
    } catch (e) { 
        ui.btnLogin.disabled = false; ui.btnLogin.innerText = isLoginMode ? 'Войти в аккаунт' : 'Создать аккаунт';
        if (e.code === 'auth/email-already-in-use') showCustomAlert('Этот ник уже занят, выбери другой!'); 
        else if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found') showCustomAlert('Неверный ник или пароль.'); 
        else showCustomAlert(`Ошибка сети: ${e.code}`);
    }
});

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => { 
        document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active')); 
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active')); 
        btn.classList.add('active'); 
        document.getElementById(btn.dataset.target).classList.add('active'); 
    };
});

// Слушатель состояния сессии
onAuthStateChanged(auth, async (user) => {
    if (user) { 
        showScreen('main');
        setUserOnline(user.uid);
        startChatListTimeout();
        listenToChatList(); 
        
        onSnapshot(doc(db, 'users', user.uid), (snap) => {
            if (snap.exists()) {
                currentUserData = snap.data();
                currentUserData.uid = user.uid;
                document.getElementById('my-username').innerText = currentUserData.username; 
                const myAvatar = document.getElementById('my-avatar'); 
                myAvatar.innerText = currentUserData.avatarEmoji; 
                if (currentUserData.isCustomColor || currentUserData.avatarColor.startsWith('#')) { 
                    myAvatar.style.background = currentUserData.avatarColor; myAvatar.removeAttribute('data-color'); 
                } else { 
                    myAvatar.setAttribute('data-color', currentUserData.avatarColor); myAvatar.style.background = ''; 
                }
            }
        });
    } else { 
        clearTimeout(chatListTimeout);
        currentUserData = null;
        showScreen('onboarding'); ui.btnLogin.disabled = false; ui.btnLogin.innerText = isLoginMode ? 'Войти в аккаунт' : 'Создать аккаунт';
    }
    hidePreloader();
});

// --- ГЛОБАЛЬНАЯ ФУНКЦИЯ ОТКРЫТИЯ ЧАТА ---
function openChatRoom(chatId, userData) {
    currentChatId = chatId; currentOtherId = userData.uid;
    
    const chatSubtitle = document.getElementById('chat-subtitle');
    const onlineDot = document.getElementById('chat-header-online-dot');

    if (unsubscribeUserOnline) unsubscribeUserOnline();
    let headerUserData = { ...userData };
    const renderHeaderProfile = (uData) => {
        document.getElementById('chat-title').innerText = getContactDisplayName(uData.uid, uData);
        const chatHeaderAvatar = document.getElementById('chat-header-avatar');
        chatHeaderAvatar.innerText = uData.avatarEmoji;
        chatHeaderAvatar.style.background = (uData.isCustomColor || uData.avatarColor.startsWith('#')) ? uData.avatarColor : (gradients[uData.avatarColor] || gradients['sky']);
    };
    const renderOnlineStatus = (statusData = {}) => {
        const lastSeenDate = toDate(statusData.lastSeen);
        if (statusData.isOnline) { 
            currentOnlineStatusText = 'в сети'; 
            onlineDot.classList.remove('hidden'); 
        } else { 
            currentOnlineStatusText = formatLastSeen(lastSeenDate, headerUserData.gender); 
            onlineDot.classList.add('hidden'); 
        }
        if (!chatSubtitle.classList.contains('typing')) chatSubtitle.innerText = currentOnlineStatusText;
    };
    renderHeaderProfile(headerUserData);
    renderOnlineStatus();

    const unsubscribeProfileHeader = onSnapshot(doc(db, 'users', userData.uid), (docSnap) => {
        if (docSnap.exists()) {
            headerUserData = { uid: userData.uid, ...docSnap.data() };
            renderHeaderProfile(headerUserData);
        }
    });
    const unsubscribeStatus = onValue(rtdbRef(rtdb, `status/${userData.uid}`), (snap) => renderOnlineStatus(snap.val() || {}));
    unsubscribeUserOnline = () => { unsubscribeProfileHeader(); unsubscribeStatus(); };

    if (unsubscribeChatHeader) unsubscribeChatHeader();
    unsubscribeChatHeader = onValue(rtdbRef(rtdb, `typing/${chatId}/${userData.uid}`), (snap) => {
        const typingState = snap.val();
        if (typingState) { chatSubtitle.innerText = typingState; chatSubtitle.classList.add('typing'); } 
        else { chatSubtitle.classList.remove('typing'); chatSubtitle.innerText = currentOnlineStatusText; }
    });

    document.getElementById('chat-messages').innerHTML = ''; 
    showScreen('chat');
    listenToMessages(currentChatId); 
}

// Нажатие на шапку чата для входа в чужой профиль
const openProfileTrigger = () => {
    if (!currentOtherId) return;
    currentProfileUserId = currentOtherId;
    
    getDoc(doc(db, 'users', currentProfileUserId)).then(docSnap => {
        if (docSnap.exists()) {
            const pData = docSnap.data();
            pData.uid = currentProfileUserId;
            
            const hasCustom = currentUserData?.customNames?.[pData.uid];
            document.getElementById('profile-fullname').innerText = hasCustom ? currentUserData.customNames[pData.uid] : `${pData.firstName} ${pData.lastName}`;
            
            const profAv = document.getElementById('profile-avatar');
            profAv.innerText = pData.avatarEmoji;
            profAv.style.background = (pData.isCustomColor || pData.avatarColor.startsWith('#')) ? pData.avatarColor : (gradients[pData.avatarColor] || gradients['sky']);
            
            document.getElementById('profile-username').innerText = pData.username;
            document.getElementById('profile-bio').innerText = pData.bio || 'Нет описания';
            document.getElementById('profile-dob').innerText = pData.dob || 'Не указана';
            document.getElementById('profile-gender').innerText = pData.gender === 'male' ? 'Мужской' : 'Женский';
            
            showScreen('profile');
        }
    });
};
document.querySelector('.title-pill').onclick = openProfileTrigger;
document.querySelector('.action-pill').onclick = openProfileTrigger;

document.getElementById('btn-back-from-profile').onclick = () => { screens.profile.classList.remove('active'); };

// Три точки в профиле (модалка удаления)
document.getElementById('btn-profile-more').onclick = () => { document.getElementById('profile-menu-modal').classList.add('active'); };
document.getElementById('btn-chat-cancel').onclick = () => { document.getElementById('profile-menu-modal').classList.remove('active'); };

document.getElementById('btn-chat-delete-me').onclick = async () => {
    document.getElementById('profile-menu-modal').classList.remove('active');
    if (currentChatId) {
        await setDoc(doc(db, 'chats', currentChatId), { visibleTo: arrayRemove(auth.currentUser.uid) }, { merge: true });
        document.getElementById('btn-back-from-profile').click();
        document.getElementById('btn-back-to-main').click();
    }
};

// Обновленная функция: Удаление чата у всех
document.getElementById('btn-chat-delete-all').onclick = async () => {
    document.getElementById('profile-menu-modal').classList.remove('active');
    
    if (currentChatId && await showCustomAlert("Удалить чат у всех пользователей? Это нельзя отменить.", true)) {
        const chatIdToDelete = currentChatId;
        
        // Визуально выкидываем на главный экран
        document.getElementById('btn-back-from-profile').click();
        document.getElementById('btn-back-to-main').click();
        
        // 1. Мгновенно скрываем чат у обоих пользователей
        await setDoc(doc(db, 'chats', chatIdToDelete), { 
            visibleTo: [], 
            participants: [] 
        }, { merge: true });
        
        // 2. Без задержек чистим коллекцию сообщений под капотом
        const msgs = await getDocs(collection(db, 'chats', chatIdToDelete, 'messages'));
        for(let d of msgs.docs) { 
            await deleteDoc(doc(db, 'chats', chatIdToDelete, 'messages', d.id)); 
        }
        
        // 3. Удаляем сам документ чата
        await deleteDoc(doc(db, 'chats', chatIdToDelete));
    }
};

// Карандаш изменения имени контакта в профиле
document.getElementById('btn-edit-contact-name').onclick = () => {
    if (!currentProfileUserId) return;
    const existing = currentUserData?.customNames?.[currentProfileUserId] || '';
    document.getElementById('custom-name-input').value = existing;
    document.getElementById('custom-name-modal').classList.add('active');
};
document.getElementById('btn-custom-name-cancel').onclick = () => { document.getElementById('custom-name-modal').classList.remove('active'); };
document.getElementById('btn-custom-name-save').onclick = async () => {
    const val = document.getElementById('custom-name-input').value.trim();
    document.getElementById('custom-name-modal').classList.remove('active');
    if (currentProfileUserId) {
        const cNames = { ...(currentUserData.customNames || {}) };
        if (val) cNames[currentProfileUserId] = val; else delete cNames[currentProfileUserId];
        await setDoc(doc(db, 'users', auth.currentUser.uid), { customNames: cNames }, { merge: true });
        
        if (val) document.getElementById('profile-fullname').innerText = val;
        else {
            const snap = await getDoc(doc(db, 'users', currentProfileUserId));
            if (snap.exists()) document.getElementById('profile-fullname').innerText = `${snap.data().firstName} ${snap.data().lastName}`;
        }
    }
};

// --- СПИСОК ЧАТОВ ---
function listenToChatList() {
    const q = query(collection(db, 'chats'), where('visibleTo', 'array-contains', auth.currentUser.uid));
    unsubscribeChats = onSnapshot(q, async (snapshot) => {
        markChatListArrived();
        const tabChats = document.getElementById('tab-chats');
        if (snapshot.empty) { tabChats.innerHTML = '<div class="empty-state">Нет active чатов. Воздух чист 💨</div>'; return; }

        let chats = [];
        snapshot.forEach(docSnap => chats.push({ id: docSnap.id, data: docSnap.data() }));
        chats.sort((a, b) => (b.data.updatedAt?.toMillis() || 0) - (a.data.updatedAt?.toMillis() || 0));

        for (let chat of chats) {
            const otherUserId = chat.data.participants.find(id => id !== auth.currentUser.uid);
            if (otherUserId && !userCache[otherUserId]) {
                const userSnap = await getDoc(doc(db, 'users', otherUserId));
                if (userSnap.exists()) { userCache[otherUserId] = userSnap.data(); userCache[otherUserId].uid = otherUserId; }
            }
        }

        const fragment = document.createDocumentFragment();
        for (let chat of chats) {
            const otherUserId = chat.data.participants.find(id => id !== auth.currentUser.uid);
            const userData = userCache[otherUserId];
            if (!userData) continue;

            const card = document.createElement('div'); card.className = 'user-card';
            let rawColor = (userData.isCustomColor || userData.avatarColor.startsWith('#')) ? userData.avatarColor : (gradients[userData.avatarColor] || gradients['sky']);
            
            const cleanName = getContactDisplayName(otherUserId, userData);
            const lastMsg = chat.data.lastMessageText || 'Нет сообщений';
            const timeStr = formatTime(chat.data.updatedAt?.toDate());
            const unreadCount = chat.data[`unread_${auth.currentUser.uid}`] || 0;
            const badgeHtml = unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : '';

            card.innerHTML = `
                <div class="avatar-container"><div class="emoji-avatar user-card-avatar" style="background: ${rawColor}">${userData.avatarEmoji}</div></div>
                <div class="user-card-info"><h4>${cleanName}</h4><div class="chat-preview">${lastMsg}</div></div>
                <div class="chat-meta"><span>${timeStr}</span>${badgeHtml}</div>
            `;
            card.onclick = () => openChatRoom(chat.id, userData);
            fragment.appendChild(card);
        }
        tabChats.innerHTML = ''; tabChats.appendChild(fragment);
    }, () => {
        markChatListArrived();
        showCustomAlert('Связь с сервером нестабильна. Попробуйте отключить VPN или проверить интернет 🛜');
    });
}

// --- ПОИСК КОНТАКТОВ С ПРИВАТНОСТЬЮ ---
screens.search = document.getElementById('search-modal');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
document.getElementById('btn-add-contact').onclick = () => { screens.search.classList.add('active'); searchInput.value = ''; searchResults.innerHTML = '<div class="empty-state" style="margin-top: 20px; font-size: 14px;">Введи ник для поиска</div>'; setTimeout(() => searchInput.focus(), 100); };
document.getElementById('btn-close-search').onclick = () => { screens.search.classList.remove('active'); };

let searchTimeout;
searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout); 
    const val = e.target.value.trim().toLowerCase(); 
    let queryText = val.startsWith('@') ? val : '@' + val;
    if (val === '' || (val.startsWith('@') && val.length < 2) || (!val.startsWith('@') && val.length < 2)) { searchResults.innerHTML = '<div class="empty-state" style="margin-top: 20px; font-size: 14px;">Введи ник для поиска</div>'; return; }
    searchResults.innerHTML = '<div class="empty-state" style="margin-top: 20px; font-size: 14px;">Ищем... 🔎</div>';

    searchTimeout = setTimeout(async () => {
        try {
            let mergedUsers = {};
            const qExact = query(collection(db, "users"), where("usernameLower", "==", queryText));
            const snapExact = await getDocs(qExact);
            snapExact.forEach(d => { mergedUsers[d.id] = { uid: d.id, ...d.data() }; });

            if (!val.startsWith('@')) {
                const qFirst = query(collection(db, "users"), where("firstNameLower", ">=", val), where("firstNameLower", "<=", val + '\uf8ff'));
                const qLast = query(collection(db, "users"), where("lastNameLower", ">=", val), where("lastNameLower", "<=", val + '\uf8ff'));
                const [sFirst, sLast] = await Promise.all([getDocs(qFirst), getDocs(qLast)]);
                sFirst.forEach(d => { const data = d.data(); if(!data.isPrivate) mergedUsers[d.id] = { uid: d.id, ...data }; });
                sLast.forEach(d => { const data = d.data(); if(!data.isPrivate) mergedUsers[d.id] = { uid: d.id, ...data }; });
            } else if (val.startsWith('@') && val.length >= 3) {
                const qPartial = query(collection(db, "users"), where("usernameLower", ">=", queryText), where("usernameLower", "<=", queryText + '\uf8ff'));
                const snapPartial = await getDocs(qPartial);
                snapPartial.forEach(d => { const data = d.data(); if(!data.isPrivate) mergedUsers[d.id] = { uid: d.id, ...data }; });
            }

            searchResults.innerHTML = '';
            const uids = Object.keys(mergedUsers).filter(id => id !== auth.currentUser.uid);
            if (uids.length === 0) { searchResults.innerHTML = '<div class="empty-state" style="margin-top: 20px; font-size: 14px;">Никто не найден 🫥</div>'; return; }

            uids.forEach(id => {
                const uData = mergedUsers[id];
                const card = document.createElement('div'); card.className = 'user-card';
                let rawColor = (uData.isCustomColor || uData.avatarColor.startsWith('#')) ? uData.avatarColor : (gradients[uData.avatarColor] || gradients['sky']);
                card.innerHTML = `<div class="emoji-avatar user-card-avatar" style="background: ${rawColor}">${uData.avatarEmoji}</div><div class="user-card-info"><h4>${getContactDisplayName(id, uData)}</h4><div class="chat-preview">${uData.username}</div></div>`;
                card.onclick = () => { screens.search.classList.remove('active'); const myId = auth.currentUser.uid; const cid = myId < uData.uid ? `${myId}_${uData.uid}` : `${uData.uid}_${myId}`; openChatRoom(cid, uData); };
                searchResults.appendChild(card);
            });
        } catch(err) { searchResults.innerHTML = '<div class="empty-state" style="margin-top: 20px; font-size: 14px;">Ошибка поиска ❌</div>'; }
    }, 500);
});

// Хелпер долгого нажатия
function bindLongPress(element, callback) {
    let timer; let isLong = false;
    const start = (e) => { if (e.type === 'mousedown' && e.button !== 0) return; isLong = false; timer = setTimeout(() => { isLong = true; callback(); }, 500); };
    const end = () => clearTimeout(timer);
    element.addEventListener('mousedown', start); element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('mouseup', end); element.addEventListener('touchend', end); element.addEventListener('mouseleave', end);
    element.addEventListener('click', (e) => { if (isLong) { e.preventDefault(); e.stopPropagation(); } });
}

// --- ЛОГИКА ЭКРАНА ЧАТА: СООБЩЕНИЯ ---
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');

function listenToMessages(chatId) {
    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'));
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        const fragment = document.createDocumentFragment();
        let hasUnreadIncoming = false;
        let prevSenderId = null; let prevTimeMs = 0; 

        snapshot.forEach((msgSnap) => {
            const data = msgSnap.data();
            if (data.deletedFor && data.deletedFor.includes(auth.currentUser.uid)) return;

            const isMine = data.senderId === auth.currentUser.uid;
            if (!isMine && data.status === 'sent' && document.visibilityState === 'visible') {
                hasUnreadIncoming = true;
                setDoc(doc(db, 'chats', chatId, 'messages', msgSnap.id), { status: 'read' }, { merge: true });
            }
            
            const currentMsgTimeMs = data.createdAt ? data.createdAt.toMillis() : Date.now();
            const timeStr = data.createdAt ? formatTime(data.createdAt.toDate()) : formatTime(new Date());
            const isGrouped = (prevSenderId === data.senderId) && ((currentMsgTimeMs - prevTimeMs) < 60000);

            const msgDiv = document.createElement('div');
            msgDiv.className = `message ${isMine ? 'mine' : 'theirs'} ${isGrouped ? 'grouped' : ''}`;
            let statusIcon = isMine ? (data.status === 'read' ? checkRead : checkSent) : '';
            let editedLabel = data.isEdited ? `<span style="font-size:10px; opacity:0.6; margin-right:4px;">изменено</span>` : '';

            msgDiv.innerHTML = `<div class="msg-content">${data.text}</div><div class="msg-meta">${editedLabel}<span>${timeStr}</span>${statusIcon}</div>`;
            
            bindLongPress(msgDiv, () => {
                longPressedMsgId = msgSnap.id;
                longPressedMsgSenderId = data.senderId;
                longPressedMsgText = data.text;
                document.getElementById('message-menu-modal').classList.add('active');
                document.getElementById('btn-msg-edit').classList.toggle('hidden', !isMine);
            });

            fragment.appendChild(msgDiv);
            prevSenderId = data.senderId; prevTimeMs = currentMsgTimeMs;
        });

        if (hasUnreadIncoming) setDoc(doc(db, 'chats', chatId), { [`unread_${auth.currentUser.uid}`]: 0 }, { merge: true });
        chatMessages.innerHTML = ''; chatMessages.appendChild(fragment);
        chatMessages.scrollTop = chatMessages.scrollHeight; 
    });
}

// Контекстное меню сообщений
document.getElementById('btn-msg-cancel').onclick = () => { document.getElementById('message-menu-modal').classList.remove('active'); };
document.getElementById('btn-msg-edit').onclick = () => {
    document.getElementById('message-menu-modal').classList.remove('active');
    if (longPressedMsgSenderId === auth.currentUser.uid) {
        editingMessageId = longPressedMsgId;
        messageInput.value = longPressedMsgText;
        messageInput.placeholder = "Редактирование...";
        messageInput.focus();
    }
};
document.getElementById('btn-msg-delete-me').onclick = async () => {
    document.getElementById('message-menu-modal').classList.remove('active');
    if (currentChatId && longPressedMsgId) {
        await setDoc(doc(db, 'chats', currentChatId, 'messages', longPressedMsgId), { deletedFor: arrayUnion(auth.currentUser.uid) }, { merge: true });
    }
};
document.getElementById('btn-msg-delete-all').onclick = async () => {
    document.getElementById('message-menu-modal').classList.remove('active');
    if (currentChatId && longPressedMsgId) {
        await deleteDoc(doc(db, 'chats', currentChatId, 'messages', longPressedMsgId));
    }
};

// --- УМНЫЙ ТАЙМИНГ ПЕЧАТИ ---
let lastKeyTime = 0; let typingState = null; let typingInterval = null;
function updateTypingState(newState) {
    if (typingState === newState) return; typingState = newState;
    if (currentChatId && auth.currentUser) {
        const typingRef = rtdbRef(rtdb, `typing/${currentChatId}/${auth.currentUser.uid}`);
        if (newState) onDisconnect(typingRef).set(null);
        rtdbSet(typingRef, newState);
    }
    if (newState === null && typingInterval) { clearInterval(typingInterval); typingInterval = null; }
}
function checkTypingStatus() {
    const diff = Date.now() - lastKeyTime; let s = null;
    if (diff < 3000) s = 'быстро печатает...'; else if (diff < 6000) s = 'печатает...'; else if (diff < 10000) s = 'долго печатает...'; else if (diff < 30000) s = 'думает...';
    updateTypingState(s);
}
messageInput.addEventListener('input', function() {
    this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px'; 
    if(this.value === '') { this.style.height = 'auto'; updateTypingState(null); return; }
    lastKeyTime = Date.now();
    if (!typingInterval) typingInterval = setInterval(checkTypingStatus, 1000);
    checkTypingStatus();
});

// Отправка сообщений
document.getElementById('btn-send-msg').onclick = async () => {
    const text = messageInput.value.trim(); if (!text || !currentChatId) return; 
    messageInput.value = ''; messageInput.style.height = 'auto'; updateTypingState(null); 

    if (editingMessageId) {
        await setDoc(doc(db, 'chats', currentChatId, 'messages', editingMessageId), { text: text, isEdited: true }, { merge: true });
        editingMessageId = null; messageInput.placeholder = "Сообщение...";
        return;
    }

    const participants = currentChatId.split('_'); 
    setDoc(doc(db, 'chats', currentChatId), { participants: participants, visibleTo: participants, updatedAt: serverTimestamp(), lastMessageText: text, [`unread_${currentOtherId}`]: increment(1) }, { merge: true });
    addDoc(collection(db, 'chats', currentChatId, 'messages'), { text: text, senderId: auth.currentUser.uid, createdAt: serverTimestamp(), status: 'sent' });
};

document.getElementById('btn-back-to-main').onclick = () => {
    if (unsubscribeMessages) unsubscribeMessages(); if (unsubscribeChatHeader) unsubscribeChatHeader(); if (unsubscribeUserOnline) unsubscribeUserOnline();
    updateTypingState(null); currentChatId = null; currentOtherId = null; chatMessages.innerHTML = ''; showScreen('main'); 
};

// --- РЕДАКТИРОВАНИЕ СОБСТВЕННОГО ПРОФИЛЯ ---
let editSelectedColor = 'sky'; let editIsCustomColor = false;
const editUi = {
    modal: document.getElementById('edit-profile-modal'),
    emoji: document.getElementById('edit-emoji'),
    dots: document.querySelectorAll('#edit-color-options .color-dot'),
    picker: document.getElementById('edit-custom-color-picker'),
    btnSave: document.getElementById('btn-save-profile'),
    btnClose: document.getElementById('btn-close-edit-profile')
};

function updateEditPreview(colorValue, isCustom) {
    if (isCustom) editUi.emoji.style.background = colorValue;
    else editUi.emoji.style.background = gradients[colorValue];
}

editUi.dots.forEach(dot => {
    dot.addEventListener('click', () => {
        editUi.dots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        if (dot.classList.contains('rainbow-dot')) { editIsCustomColor = true; editSelectedColor = editUi.picker.value; } 
        else { editIsCustomColor = false; editSelectedColor = dot.dataset.color; }
        updateEditPreview(editSelectedColor, editIsCustomColor);
    });
});

editUi.picker.addEventListener('input', (e) => {
    editSelectedColor = e.target.value; editIsCustomColor = true;
    editUi.dots.forEach(d => d.classList.remove('active'));
    document.querySelector('#edit-color-options .rainbow-dot').classList.add('active');
    updateEditPreview(editSelectedColor, true);
});

document.getElementById('btn-edit-my-profile').onclick = () => {
    if (!currentUserData) return;
    document.getElementById('edit-first-name').value = currentUserData.firstName || '';
    document.getElementById('edit-last-name').value = currentUserData.lastName || '';
    document.getElementById('edit-bio').value = currentUserData.bio || '';
    document.getElementById('edit-dob').value = currentUserData.dob || '';
    document.getElementById('edit-gender').value = currentUserData.gender || 'male';
    document.getElementById('edit-privacy').value = currentUserData.isPrivate ? 'private' : 'public';
    
    editUi.emoji.value = currentUserData.avatarEmoji || '😊';
    editSelectedColor = currentUserData.avatarColor || 'sky';
    editIsCustomColor = currentUserData.isCustomColor || false;
    
    editUi.dots.forEach(d => d.classList.remove('active'));
    if (editIsCustomColor) {
        document.querySelector('#edit-color-options .rainbow-dot').classList.add('active');
        editUi.picker.value = editSelectedColor;
    } else {
        const dot = document.querySelector(`#edit-color-options .color-dot[data-color="${editSelectedColor}"]`);
        if (dot) dot.classList.add('active');
    }
    updateEditPreview(editSelectedColor, editIsCustomColor);
    editUi.modal.classList.add('active');
};

editUi.btnClose.onclick = () => { editUi.modal.classList.remove('active'); };

editUi.btnSave.onclick = async () => {
    const fName = document.getElementById('edit-first-name').value.trim();
    const lName = document.getElementById('edit-last-name').value.trim();
    const bioVal = document.getElementById('edit-bio').value.trim();
    const dobVal = document.getElementById('edit-dob').value;
    const genVal = document.getElementById('edit-gender').value;
    const privVal = document.getElementById('edit-privacy').value;

    if (!fName || !lName) return showCustomAlert('Имя и Фамилия обязательны!');
    if (fName.length > 15 || lName.length > 15) return showCustomAlert('Предел длины имени/фамилии — 15 символов!');

    editUi.btnSave.disabled = true; editUi.btnSave.innerText = 'Сохранение...';
    try {
        await setDoc(doc(db, 'users', auth.currentUser.uid), {
            firstName: fName, lastName: lName,
            firstNameLower: fName.toLowerCase(), lastNameLower: lName.toLowerCase(),
            bio: bioVal, dob: dobVal, gender: genVal, isPrivate: privVal === 'private',
            avatarEmoji: editUi.emoji.value.trim() || '😊', avatarColor: editSelectedColor, isCustomColor: editIsCustomColor
        }, { merge: true });
        editUi.modal.classList.remove('active');
    } catch(err) { showCustomAlert('Ошибка: ' + err.code); }
    editUi.btnSave.disabled = false; editUi.btnSave.innerText = 'Сохранить изменения';
};

// Нативные Push-уведомления (iOS 16.4+ PWA / Android / Desktop)
document.getElementById('btn-enable-notifications').onclick = async () => {
    // 1. Проверяем, поддерживает ли браузер Notification API
    if (!('Notification' in window)) {
        showCustomAlert('Уведомления не поддерживаются в этом браузере. Если вы на iOS — убедитесь, что приложение добавлено на экран «Домой» и версия iOS 16.4 или выше.');
        return;
    }

    // 2. Если разрешение уже получено
    if (Notification.permission === 'granted') {
        showCustomAlert('Уведомления уже включены ✅');
        return;
    }

    // 3. Если пользователь ранее запретил — iOS/Safari не покажет повторный промпт
    if (Notification.permission === 'denied') {
        showCustomAlert('Уведомления заблокированы. Чтобы включить их, перейдите в Настройки устройства ➔ Air Messenger ➔ Уведомления.');
        return;
    }

    // 4. Запрашиваем разрешение (permission === 'default')
    try {
        const result = await Notification.requestPermission();

        if (result === 'granted') {
            showCustomAlert('Уведомления успешно включены! 🎉');
            // Тестовое уведомление, чтобы пользователь увидел результат
            new Notification('Air Messenger', {
                body: 'Теперь вы будете получать уведомления о новых сообщениях ✉️',
                icon: 'icon-512.jpg'
            });
        } else if (result === 'denied') {
            showCustomAlert('Вы запретили уведомления. Чтобы включить их позже, зайдите в Настройки устройства ➔ Air Messenger ➔ Уведомления.');
        } else {
            // result === 'default' — пользователь закрыл промпт без выбора
            showCustomAlert('Вы не выбрали действие. Попробуйте ещё раз.');
        }
    } catch (err) {
        console.error('Notification permission error:', err);
        showCustomAlert('Произошла ошибка при запросе уведомлений. Попробуйте ещё раз.');
    }
};


// Выход из аккаунта
document.getElementById('btn-logout').onclick = () => {
    if (auth.currentUser) { updateTypingState(null); setUserOffline(auth.currentUser.uid); }
    if (unsubscribeChats) unsubscribeChats(); clearTimeout(chatListTimeout); signOut(auth);
};

// Тотальное удаление аккаунта под ноль
document.getElementById('btn-delete-acc').onclick = async () => {
    if (await showCustomAlert("Удалить аккаунт НАВСЕГДА? Все чаты и сообщения будут стерты под ноль.", true)) {
        try {
            const myUid = auth.currentUser.uid;
            const snap = await getDocs(query(collection(db, 'chats'), where('participants', 'array-contains', myUid)));
            for (let cDoc of snap.docs) {
                const msgs = await getDocs(collection(db, 'chats', cDoc.id, 'messages'));
                for (let mDoc of msgs.docs) { await deleteDoc(doc(db, 'chats', cDoc.id, 'messages', mDoc.id)); }
                await deleteDoc(doc(db, 'chats', cDoc.id));
            }
            await deleteDoc(doc(db, 'users', myUid));
            await deleteUser(auth.currentUser);
        } catch (e) { showCustomAlert("Ошибка удаления: " + e.code); }
    }
};

// Настройки темы
const themeToggle = document.getElementById('theme-toggle');
if (localStorage.getItem('theme') === 'dark') { document.body.classList.add('dark-mode'); themeToggle.checked = true; }
themeToggle.addEventListener('change', (e) => {
    document.body.classList.toggle('dark-mode', e.target.checked);
    localStorage.setItem('theme', e.target.checked ? 'dark' : 'light');
});

document.getElementById('btn-call').onclick = () => showCustomAlert('Здесь будет выбор: Аудио или Видео звонок 📞');

// --- УПРАВЛЕНИЕ СТАТУСОМ (ОНЛАЙН/ОФФЛАЙН) ПРИ СВОРАЧИВАНИИ ---
function handleAppVisibility() {
    if (!auth.currentUser) return;
    
    if (document.visibilityState === 'hidden') {
        // Ушли в фон - ставим оффлайн и сбрасываем набор текста
        setUserOffline(auth.currentUser.uid);
        updateTypingState(null);
    } else if (document.visibilityState === 'visible') {
        // Вернулись в приложение - ставим онлайн
        setUserOnline(auth.currentUser.uid);
    }
}

document.addEventListener('visibilitychange', handleAppVisibility);

window.addEventListener('focus', () => {
    if (document.visibilityState === 'visible' && auth.currentUser) {
        setUserOnline(auth.currentUser.uid);
    }
});

// Для iOS / PWA / Cordova
document.addEventListener('resume', () => {
    if (auth.currentUser) setUserOnline(auth.currentUser.uid);
}, false);

// Слушаем системный статус подключения к Firebase RTDB (надежный способ для реконнектов)
onValue(rtdbRef(rtdb, '.info/connected'), (snap) => {
    if (snap.val() === true && auth.currentUser && document.visibilityState === 'visible') {
        setUserOnline(auth.currentUser.uid);
    }
});