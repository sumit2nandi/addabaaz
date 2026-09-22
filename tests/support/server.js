import { createApp } from '../../backend/src/app.js';
import { MemoryRepository, token } from './fixture.js';
// Explicitly a browser-test server. Production always uses ContentRepository/MySQL.
const port = Number(process.env.PORT || 3000);
createApp({ repository: new MemoryRepository(), adminToken: token, limit: 100000 }).listen(port, '0.0.0.0', () => console.log(`TEST FIXTURE API + frontend on ${port}; NOT connected to MySQL`));
