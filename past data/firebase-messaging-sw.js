importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyB1B-XxzJQ29ZtodYn-BWUshf2Q6gkLI-U",
  authDomain: "study-with-j.firebaseapp.com",
  projectId: "study-with-j",
  storageBucket: "study-with-j.firebasestorage.app",
  messagingSenderId: "694637260914",
  appId: "1:694637260914:web:445ca1159c35f500da92eb"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  const data = payload.data || {};
  const title = n.title || data.title || '한일공부방 알림';
  const options = {
        icon: '/icon-192.png',
    badge: '/icon-192.png',
    data
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
