import { readdirSync, readFileSync } from 'node:fs';

const files = readdirSync('dist-site/assets');
const fixtureChunks = files.filter(name => /authored|episodes|views/.test(name));
const payload = files.filter(name => name.endsWith('.js')).map(name => readFileSync(`dist-site/assets/${name}`, 'utf8')).join('\n');
const fixtureMarkers = ['retake.authored.v1', '转发预览已确认：', '剧内预制声纹 player_word。'].filter(marker => payload.includes(marker));
console.log({ siteAssets: files, fixtureChunks, fixtureMarkers });
if (fixtureChunks.length || fixtureMarkers.length) throw new Error('Site output contains authored rehearsal data.');
