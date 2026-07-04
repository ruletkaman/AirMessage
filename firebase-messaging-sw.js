importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyAQbze_wKkHFdBbWq0FHAgKOiFn07x4OrU",
    authDomain: "airmessage-49c55.firebaseapp.com",
    databaseURL: "https://airmessage-49c55-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "airmessage-49c55",
    storageBucket: "airmessage-49c55.firebasestorage.app",
    messagingSenderId: "697695491479",
    appId: "1:697695491479:web:3860154eae46301451e0d2"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const notification = payload.notification || {};
    const data = payload.data || {};
    const title = notification.title || data.title || 'Новое сообщение';
    const body = notification.body || data.body || data.text || 'Откройте Air, чтобы прочитать сообщение.';

    self.registration.showNotification(title, {
        body,
        icon: '/icon-512.jpg',
        badge: '/icon-512.jpg',
        data: {
            url: data.url || '/',
            chatId: data.chatId || data.chat_id || ''
        }
    });
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || '/';

    event.waitUntil((async () => {
        const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windowClients) {
            if ('focus' in client) {
                client.focus();
                return;
            }
        }
        if (clients.openWindow) return clients.openWindow(targetUrl);
    })());
});
