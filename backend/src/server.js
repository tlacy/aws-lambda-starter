/**
 * Local development server — not used in Lambda.
 * Loads .env with dotenv, then starts Express on PORT (default 3000).
 */

import 'dotenv/config';
import app from './app.js';

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
