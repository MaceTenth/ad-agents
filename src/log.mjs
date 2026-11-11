// Plain console logging with a timestamp. Railway and DigitalOcean show stdout in their log view;
// on a droplet systemd appends it to logs/server.log.
export const info = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
export const warn = (...a) => console.warn(`[${new Date().toISOString()}]`, ...a);
