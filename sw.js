const CACHE_NAME = "my-pwa-v3";



const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      if (event.request.url.endsWith("/hey/index")) {
        return caches.match("./index.html");
      }

      return fetch(event.request);
    })
  );
});
