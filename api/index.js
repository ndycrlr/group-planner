// Vercel entry point. An Express app is already a (req, res) handler, so it can
// be handed over as-is; vercel.json rewrites every /api/* path here, and Express
// does its own routing from the original URL.

export { default } from '../app.js';
