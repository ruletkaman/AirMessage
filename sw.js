self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

async function checkClientStatus(chatId) {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
        if (client.visibilityState === 'visible') {
            try {
                // Запрашиваем у клиента его текущий открытый чат
                const clientChatId = await new Promise((resolve) => {
                    const channel = new MessageChannel();
                    channel.port1.onmessage = (event) => resolve(event.data.chatId);
                    client.postMessage({ type: 'GET_CHAT_ID' }, [channel.port2]);
                    
                    // Fallback таймаут на случай, если клиент не отвечает
                    setTimeout(() => resolve(null), 500);
                });
                
                if (clientChatId === chatId) {
                    return true; // Открыто на экране И это нужный чат
                }
            } catch (e) {
                console.error('Error asking client for chat state', e);
            }
        }
    }
    return false; // Другой чат или свернуто
}

self.addEventListener('push', function(event) {
    if (!event.data) return;
    
    try {
        const data = event.data.json();
        const { title, body, chatId } = data;
        
        event.waitUntil(
            checkClientStatus(chatId).then(isChatFocused => {
                // Защита от спама: если приложение открыто и именно этот чат активен, не показываем пуш
                if (isChatFocused) {
                    return; 
                }
                
                // В противном случае (другой чат или свернуто) - показываем
                return self.registration.showNotification(title || 'Новое сообщение', {
                    body: body,
                    icon: '/icon-512.jpg',
                    badge: '/icon-512.jpg',
                    data: { chatId: chatId },
                    vibrate: [200, 100, 200]
                });
            })
        );
    } catch (err) {
        console.error('Error parsing push data', err);
    }
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            if (clientList.length > 0) {
                let client = clientList[0];
                for (let i = 0; i < clientList.length; i++) {
                    if (clientList[i].focused) {
                        client = clientList[i];
                    }
                }
                return client.focus();
            }
            return self.clients.openWindow('/');
        })
    );
});
