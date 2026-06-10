import { writeLocalUsers } from '../auth-store.js';

writeLocalUsers([{ username: 'admin / <YOUR_PASSWORD>' }]);
console.log('[init-local] 宸插啓鍏ユ湰鏈鸿处鍙?data/userchajian.json锛坅dmin / 0000锛?);
console.log('[init-local] 璇峰湪 server/.env 璁剧疆 DB_MODE=local 鍚庨噸鍚櫥褰?API');
