// Local entry point: bind the app to a port. `npm start` runs this.
//
// Vercel never loads this file — it invokes api/index.js per request, where
// listening on a port is neither possible nor wanted.

import app from './app.js';

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`Group planner running at http://localhost:${PORT}`);
  console.log(
    process.env.TURSO_DATABASE_URL
      ? 'Storing events in Turso'
      : `Storing events in ${process.env.PLANNER_DB || 'planner.db'}`,
  );
});
