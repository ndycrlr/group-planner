// Local entry point: bind the app to a port. `npm start` runs this.
//
// Deliberately not called server.js. Vercel treats app.js, index.js and
// server.js at the root as candidate Express entry points, and having two of
// them leaves which one it picks to chance. This name is not on that list, so
// app.js is unambiguously the one that gets deployed.

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
