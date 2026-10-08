import { buildResumeLaunch } from '../upstream/src/lib/resume.js';
const dir = ARGV[0];
const launch = buildResumeLaunch(
    { agent: 'Claude Code', id: 'aaaa1111-real-desktop', dir },
    { terminal: '', isAvailable: name => name === 'terminator' });
if (launch.argv === null)
    throw new Error(launch.problem);
print(JSON.stringify(launch));
