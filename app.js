// 註冊 PWA Service Worker 離線功能
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('PWA Service Worker 註冊成功！'))
            .catch(err => console.log('PWA Service Worker 註冊失敗：', err));
    });
}

// ==================== ✨ UI 切換邏輯 (縮放控制) ✨ ====================
function toggleBox(boxId) {
    const box = document.getElementById(boxId);
    if (box) {
        box.classList.toggle('collapsed');
    }
}

// ==================== 1. 遊戲設定與水果資料庫 ====================
// 完美緊貼的物理半徑(radius)與字體大小(fontSize)調校
const FRUIT_TYPES = [
    { name: '草莓', radius: 35, score: 2,  color: '#ff4d4d', emoji: '🍓', fontSize: 75 },
    { name: '檸檬', radius: 50, score: 5,  color: '#ffd700', emoji: '🍋', fontSize: 110 },
    { name: '橘子', radius: 70, score: 12, color: '#ffa500', emoji: '🍊', fontSize: 155 },
    { name: '番茄', radius: 95, score: 25, color: '#ff6347', emoji: '🍅', fontSize: 215 },
    { name: '葡萄', radius: 125, score: 50, color: '#9370db', emoji: '🍇', fontSize: 290 },
    { name: '西瓜', radius: 160, score: 100,color: '#2ed573', emoji: '🍉', fontSize: 380 }
];

const DEAD_LINE_Y = 220; // 💀 水平死亡線的 Y 軸位置
let currentScore = 0;
let currentMode = 'login';
let currentUser = null;

let currentFruitIndex = 0; // 當前手上握著的水果
let nextFruitIndex = 0;    // 下一個預期水果
let currentMouseX = 250;   // 紀錄滑鼠或手指目前的 X 位置
let gameOverCounter = 0;   // 用來計算超過死亡線的時間

// ==================== 2. 使用者系統（LocalStorage 模擬） ====================
function switchTab(mode) {
    currentMode = mode;
    document.getElementById('tab-login').className = mode === 'login' ? 'active' : '';
    document.getElementById('tab-register').className = mode === 'register' ? 'active' : '';
    document.getElementById('submit-btn').innerText = mode === 'login' ? '進入遊戲' : '註冊並登入';
}

function handleAuth(e) {
    e.preventDefault();
    const user = document.getElementById('username').value.trim();
    const pass = document.getElementById('password').value;
    const msg = document.getElementById('auth-message');

    let db = JSON.parse(localStorage.getItem('fruit_game_users')) || {};

    if (currentMode === 'register') {
        if (db[user]) { msg.innerText = "❌ 帳號已存在！"; return; }
        db[user] = { password: pass, highscore: 0 };
        localStorage.setItem('fruit_game_users', JSON.stringify(db));
    } else {
        if (!db[user] || db[user].password !== pass) { msg.innerText = "❌ 帳號或密碼錯誤！"; return; }
    }

    currentUser = user;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    document.getElementById('current-user-tag').innerText = user;
    
    updateLeaderboardView();
    initGame(); 
}

function logout() { location.reload(); }

function updateLeaderboardView() {
    let db = JSON.parse(localStorage.getItem('fruit_game_users')) || {};
    let players = Object.keys(db).map(username => ({ username: username, highscore: db[username].highscore || 0 }));
    players.sort((a, b) => b.highscore - a.highscore);
    document.getElementById('leaderboard-list').innerHTML = players.slice(0, 5).map(p => 
        `<li>${p.username}: <strong>${p.highscore}分</strong></li>`
    ).join('');
}

function saveScore(finalScore) {
    if (!currentUser) return;
    let db = JSON.parse(localStorage.getItem('fruit_game_users')) || {};
    if (finalScore > db[currentUser].highscore) {
        db[currentUser].highscore = finalScore;
        localStorage.setItem('fruit_game_users', JSON.stringify(db));
        alert(`🎉 恭喜突破個人最高分：${finalScore} 分！`);
        updateLeaderboardView();
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

    // 建立邊界
    const wallOptions = { isStatic: true, render: { fillStyle: '#e55039' } };
    const ground = Matter.Bodies.rectangle(width/2, height - 20, width, 40, wallOptions);
    const leftWall = Matter.Bodies.rectangle(10, height/2, 20, height, wallOptions);
    const rightWall = Matter.Bodies.rectangle(width - 10, height/2, 20, height, wallOptions);
    Matter.Composite.add(engine.world, [ground, leftWall, rightWall]);

    // ✨ 初始水果隨機包含 0(草莓)、1(檸檬)、2(橘子)
    currentFruitIndex = Math.floor(Math.random() * 3);
    rollNextFruit();

    // 監聽滑鼠/手指移動
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

    // 點擊掉落
    const triggerDrop = () => {
        if (!isReadyToDrop) return;
        dropFruit(currentMouseX);
    };
    render.canvas.addEventListener('click', triggerDrop);

    // ==================== ✨ CANVAS 渲染區 ✨ ====================
    Matter.Events.on(render, 'afterRender', () => {
        const ctx = render.context;

        // 1. 繪製「水平死亡線」
        ctx.strokeStyle = gameOverCounter > 0 ? '#ff4d4d' : 'rgba(231, 76, 60, 0.6)';
        ctx.lineWidth = gameOverCounter > 0 ? 4 : 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(0, DEAD_LINE_Y);
        ctx.lineTo(width, DEAD_LINE_Y);
        ctx.stroke();
        ctx.setLineDash([]); 

        // 2. 繪製「垂直預測線」與「準備掉落的水果」
        if (isReadyToDrop) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(currentMouseX, 100);
            ctx.lineTo(currentMouseX, height);
            ctx.stroke();
            ctx.setLineDash([]);

            // 頂部手持水果預覽
            const currentFruit = FRUIT_TYPES[currentFruitIndex];
            ctx.font = `${currentFruit.fontSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(currentFruit.emoji, currentMouseX, 100);
        }

        // 3. 把物理引擎的圓球覆蓋上水果 Emoji
        const bodies = Matter.Composite.allBodies(engine.world);
        let fruitIsViolating = false;

        bodies.forEach(body => {
            if (body.fruitLevel !== undefined) {
                const config = FRUIT_TYPES[body.fruitLevel];
                
                ctx.save();
                ctx.translate(body.position.x, body.position.y);
                ctx.rotate(body.angle); 
                ctx.font = `${config.fontSize}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(config.emoji, 0, 0);
                ctx.restore();

                // 💀 檢查死亡條件
                if (body.position.y < DEAD_LINE_Y && body.position.y > 150) {
                    if (Math.abs(body.velocity.y) < 0.2) {
                        fruitIsViolating = true;
                    }
                }
            }
        });

        // 死亡計時判定
        if (fruitIsViolating) {
            gameOverCounter++;
            if (gameOverCounter > 90) { 
                handleGameOver();
                gameOverCounter = 0;
            }
        } else {
            gameOverCounter = 0;
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

// ✨ 隨機生成的新水果範圍擴大：0(草莓)、1(檸檬)、2(橘子) 隨機生成
function rollNextFruit() {
    nextFruitIndex = Math.floor(Math.random() * 3); 
    document.getElementById('next-fruit-preview').innerText = FRUIT_TYPES[nextFruitIndex].emoji;
}

function dropFruit(x) {
    isReadyToDrop = false;

    spawnFruit(x, 100, currentFruitIndex);

    currentFruitIndex = nextFruitIndex;
    rollNextFruit();

    setTimeout(() => {
        isReadyToDrop = true;
    }, 600); 
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

// ✨ 重置遊戲時，新水果也同步修正為 0 ~ 2 隨機
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
