importScripts("https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js");

const firebaseConfig = {
  apiKey: "AIzaSyAQbze_wKkHFdBbWq0FHAgKOiFn07x4OrU",
  authDomain: "airmessage-49c55.firebaseapp.com",
  databaseURL: "https://airmessage-49c55-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "airmessage-49c55",
  storageBucket: "airmessage-49c55.firebasestorage.app",
  messagingSenderId: "697695491479",
  appId: "1:697695491479:web:3860154eae46301451e0d2"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification?.title || 'Air Messenger';
  const notificationOptions = {
    body: payload.notification?.body || 'Новое сообщение',
    icon: '/icon-512.jpg'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
