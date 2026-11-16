import { createApp } from './app.js';
import { jwtSecret } from './lib/auth.js';

jwtSecret(); // fail fast in production if JWT_SECRET is missing
const port = Number(process.env.PORT) || 4100;
createApp().listen(port, () => console.log(`Brukline API on http://localhost:${port}`));
