/**
 * Prints a fresh VAPID key pair for Web Push:  npm run vapid
 * Copy the two lines into Vercel env vars (and .env.local); never commit them.
 * Changing the pair later invalidates existing subscriptions: press "Turn off" then "Turn on" in the app.
 */
import webpush from 'web-push'

const keys = webpush.generateVAPIDKeys()
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`)
