// ==================== 🔥 FIREBASE 雲端初始化配置 🔥 ====================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc, 
    collection, 
    query, 
    orderBy, 
    limit, 
    onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";



// 初始化 Firebase 與 Firestore 雲端資料庫
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 註冊 PWA Service Worker 離線功能
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('PWA Service Worker 註冊成功！'))
            .catch(err => console.log('PWA Service Worker 註冊失敗：', err));
    });
}

// 將需要讓 HTML 按鈕點擊的函式掛載到 window 全域，避免 module 找不到
window.switchTab = switchTab;
window.handleAuth = handleAuth;
window.logout = logout;
window.toggleBox = toggleBox;

// ==================== ✨ UI 切換邏輯 (縮放控制) ✨ ====================
function toggleBox(boxId) {
    const box = document.getElementById(boxId);
    if (box) {
        box.classList.toggle('collapsed');
    }
}

// ==================== 1. 遊戲設定與水果資料庫 ====================
const FRUIT_TYPES = [
    { name: '草莓', radius: 35, score: 2,  color: '#ff4d4d', emoji: '🍓', fontSize: 90 },
    { name: '檸檬', radius: 50, score: 5,  color: '#ffd700', emoji: '🍋', fontSize: 130 },
    { name: '橘子', radius: 70, score: 12, color: '#ffa500', emoji: '🍊', fontSize: 180 },
    { name: '番茄', radius: 95, score: 25, color: '#ff6347', emoji: '🍅', fontSize: 240 },
    { name: '葡萄', radius: 125, score: 50, color: '#9370db', emoji: '🍇', fontSize: 320 },
    { name: '西瓜', radius: 160, score: 100,color: '#2ed573', emoji: '🍉', fontSize: 410 }
];

const DEAD_LINE_Y = 220; // 💀 水平死亡線的 Y 軸位置
let currentScore = 0;
let currentMode = 'login';
let currentUser = null;

let currentFruitIndex = 0; // 當前手上握著的水果
let nextFruitIndex = 0;    // 下一個預期水果
let currentMouseX = 250;   // 紀錄滑鼠或手指目前的 X 位置
let gameOverCounter = 0;   // 用來計算超過死亡線的時間

// ==================== 2. 雲端使用者系統 (Firebase Firestore) ====================
function switchTab(mode) {
    currentMode = mode;
    document.getElementById('tab-login').className = mode === 'login' ? 'active' : '';
    document.getElementById('tab-register').className = mode === 'register' ? 'active' : '';
    document.getElementById('submit-btn').innerText = mode === 'login' ? '進入遊戲' : '註冊並登入';
}

async function handleAuth(e) {
    e.preventDefault();
    const user = document.getElementById('username').value.trim();
    const pass = document.getElementById('password').value;
    const msg = document.getElementById('auth-message');

    if (!user || !pass) { msg.innerText = "❌ 請輸入帳號密碼！"; return; }

    const userRef = doc(db, "users", user);

    try {
        const userDoc = await getDoc(userRef);

        if (currentMode === 'register') {
            // 雲端註冊
            if (userDoc.exists()) { msg.innerText = "❌ 帳號已存在！"; return; }
            await setDoc(userRef, { password: pass, highscore: 0 });
            msg.innerText = "🎉 註冊成功，正在登入...";
        } else {
            // 雲端登入
            if (!userDoc.exists() || userDoc.data().password !== pass) {
                msg.innerText = "❌ 帳號或密碼錯誤！"; 
                return; 
            }
        }

        // 登入成功
        currentUser = user;
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        document.getElementById('current-user-tag').innerText = user;
        
        // 啟動即時世界排行榜監聽
        listenLeaderboard();
        initGame(); 
    } catch (error) {
        console.error("Firebase 錯誤:", error);
        msg.innerText = "❌ 雲端連線失敗，請檢查網路！";
    }
}

function logout() { location.reload(); }

// 🌐 核心優化：即時監聽雲端世界排行榜（全體玩家分數一變動，這裡免重新整理直接更新）
function listenLeaderboard() {
    const q = query(collection(db, "users"), orderBy("highscore", "desc"), limit(5));
    onSnapshot(q, (snapshot) => {
        let html = "";
        let rank = 1;
        snapshot.forEach((doc) => {
            const data = doc.data();
            html += `<li>${rank}. ${doc.id}: <strong>${data.highscore || 0}分</strong></li>`;
            rank++;
        });
        document.getElementById('leaderboard-list').innerHTML = html || "<li>暫無排行紀錄</li>";
    });
}

async function saveScore(finalScore) {
    if (!currentUser) return;
    const userRef = doc(db, "users", currentUser);
    
    try {
        const userDoc = await getDoc(userRef);
        if (userDoc.exists()) {
            const oldHighScore = userDoc.data().highscore || 0;
            if (finalScore > oldHighScore) {
                // 上傳最高分到雲端
                await setDoc(userRef, { highscore: finalScore }, { merge: true });
                alert(`🎉 恭喜突破個人最高分：${finalScore} 分！已同步到世界排行榜！`);
            }
        }
    } catch (error) {
        console.error("上傳分數失敗:", error);
    }
}

// ==================== 3. 遊戲核心邏輯 (Matter.js) ====================
let engine, render, runner;
let isReadyToDrop = true;

function initGame() {
    const container = document.getElementById('game-container');
    const width = 500;
    const height = 800;

    engine = Matter.Engine.create({ gravity: { y: 1.6 } });
    
    render = Matter.Render.create({
        element: container,
        engine: engine,
        options: {
            width: width,
            height: height,
            wireframes: false,
            background: 'transparent'
        }
    });
    Matter.Render.run(render);

    runner = Matter.Runner.create();
    Matter.Runner.run(runner, engine);

    const wallOptions = { isStatic: true, render: { fillStyle: '#e55039' } };
    const ground = Matter.Bodies.rectangle(width/2, height - 20, width, 40, wallOptions);
    const leftWall = Matter.Bodies.rectangle(10, height/2, 20, height, wallOptions);
    const rightWall = Matter.Bodies.rectangle(width - 10, height/2, 20, height, wallOptions);
    Matter.Composite.add(engine.world, [ground, leftWall, rightWall]);

    currentFruitIndex = Math.floor(Math.random() * 3);
    rollNextFruit();

    const trackPosition = (e) => {
        const rect = render.canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let x = clientX - rect.left;
        
        const radius = FRUIT_TYPES[currentFruitIndex].radius;
        if (x < 20 + radius) x = 20 + radius;
        if (x > width - 20 - radius) x = width - 20 - radius;
        
        currentMouseX = x;
    };

    render.canvas.addEventListener('mousemove', trackPosition);
    render.canvas.addEventListener('touchmove', trackPosition);

    const triggerDrop = () => {
        if (!isReadyToDrop) return;
        dropFruit(currentMouseX);
    };
    render.canvas.addEventListener('click', triggerDrop);

    // ==================== ✨ CANVAS 渲染區 (圓形裁切與光圈) ✨ ====================
    Matter.Events.on(render, 'afterRender', () => {
        const ctx = render.context;

        // 1. 水平死亡線
        ctx.strokeStyle = gameOverCounter > 20 ? '#ff4d4d' : 'rgba(231, 76, 60, 0.6)';
        ctx.lineWidth = gameOverCounter > 20 ? 4 : 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(0, DEAD_LINE_Y);
        ctx.lineTo(width, DEAD_LINE_Y);
        ctx.stroke();
        ctx.setLineDash([]); 

        // 2. 垂直預測線
        if (isReadyToDrop) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(currentMouseX, 100);
            ctx.lineTo(currentMouseX, height);
            ctx.stroke();
            ctx.setLineDash([]);

            const currentFruit = FRUIT_TYPES[currentFruitIndex];
            ctx.font = `${currentFruit.fontSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(currentFruit.emoji, currentMouseX, 100);
        }

        // 3. 完美圓形裁切 Emoji 貼圖
        const bodies = Matter.Composite.allBodies(engine.world);
        let fruitIsViolating = false;

        bodies.forEach(body => {
            if (body.fruitLevel !== undefined) {
                const config = FRUIT_TYPES[body.fruitLevel];
                
                // --- 圓形裁切 ---
                ctx.save();
                ctx.translate(body.position.x, body.position.y);
                
                ctx.beginPath();
                ctx.arc(0, 0, config.radius, 0, 2 * Math.PI);
                ctx.closePath();
                ctx.clip(); 
                
                ctx.rotate(body.angle); 
                ctx.font = `${config.fontSize}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(config.emoji, 0, 0);
                ctx.restore();

                // --- 葡萄和西瓜外圍光圈 ---
                if (body.fruitLevel === 4 || body.fruitLevel === 5) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(body.position.x, body.position.y, config.radius, 0, 2 * Math.PI);
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)'; 
                    ctx.lineWidth = 6; 
                    ctx.stroke();
                    ctx.restore();
                }

                // 💀 檢查死亡條件
                const topEdge = body.position.y - config.radius;
                if (topEdge < DEAD_LINE_Y && body.position.y > 130) {
                    if (Math.abs(body.velocity.y) < 0.5 && Math.abs(body.velocity.x) < 0.5) {
                        fruitIsViolating = true;
                    }
                }
            }
        });

        if (fruitIsViolating) {
            gameOverCounter++;
            if (gameOverCounter > 60) { 
                handleGameOver();
                gameOverCounter = 0;
            }
        } else {
            if (gameOverCounter > 0) gameOverCounter -= 2;
        }
    });

    // 監聽合成碰撞
    Matter.Events.on(engine, 'collisionStart', (event) => {
        const pairs = event.pairs;
        pairs.forEach(pair => {
            const bodyA = pair.bodyA;
            const bodyB = pair.bodyB;

            if (bodyA.fruitLevel !== undefined && bodyB.fruitLevel !== undefined) {
                if (bodyA.fruitLevel === bodyB.fruitLevel) {
                    const currentLevel = bodyA.fruitLevel;
                    if (currentLevel >= FRUIT_TYPES.length - 1) return; 

                    const midX = (bodyA.position.x + bodyB.position.x) / 2;
                    const midY = (bodyA.position.y + bodyB.position.y) / 2;

                    Matter.Composite.remove(engine.world, [bodyA, bodyB]);

                    const nextLevel = currentLevel + 1;
                    currentScore += FRUIT_TYPES[nextLevel].score;
                    document.getElementById('score').innerText = currentScore;

                    spawnFruit(midX, midY, nextLevel);
                }
            }
        });
    });
}

function rollNextFruit() {
    nextFruitIndex = Math.floor(Math.random() * 3); 
    document.getElementById('next-fruit-preview').innerText = FRUIT_TYPES[nextFruitIndex].emoji;
}

function dropFruit(x) {
    isReadyToDrop = false;
    spawnFruit(x, 100, currentFruitIndex);
    currentFruitIndex = nextFruitIndex;
    rollNextFruit();
    setTimeout(() => { isReadyToDrop = true; }, 600); 
}

function spawnFruit(x, y, level) {
    const config = FRUIT_TYPES[level];
    const fruit = Matter.Bodies.circle(x, y, config.radius, {
        restitution: 0.2,
        friction: 0.1,
        render: { visible: false } 
    });
    fruit.fruitLevel = level;
    Matter.Composite.add(engine.world, fruit);
}

function handleGameOver() {
    saveScore(currentScore);
    alert(`👻 堆太高啦！遊戲結束！您的最終得分是：${currentScore} 分`);
    resetGame(); 
}

function resetGame() {
    const bodies = Matter.Composite.allBodies(engine.world);
    bodies.forEach(body => {
        if (body.fruitLevel !== undefined) {
            Matter.Composite.remove(engine.world, body);
        }
    });
    currentScore = 0;
    document.getElementById('score').innerText = currentScore;
    gameOverCounter = 0;
    isReadyToDrop = true;
    currentFruitIndex = Math.floor(Math.random() * 3);
    rollNextFruit();
}
