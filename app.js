// 註冊 PWA Service Worker 離線功能
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('PWA Service Worker 註冊成功！', reg.scope))
            .catch(err => console.log('PWA Service Worker 註冊失敗：', err));
    });
}

// (下面維持原本的 FRUIT_TYPES 遊戲程式碼...)
// ==================== 1. 遊戲設定與水果資料庫 ====================
const FRUIT_TYPES = [
    { name: '草莓', radius: 15, score: 2,  color: '#ff4d4d', emoji: '🍓' },
    { name: '檸檬', radius: 25, score: 5,  color: '#ffd700', emoji: '🍋' },
    { name: '橘子', radius: 35, score: 12, color: '#ffa500', emoji: '🍊' },
    { name: '番茄', radius: 48, score: 25, color: '#ff6347', emoji: '🍅' },
    { name: '葡萄', radius: 62, score: 50, color: '#9370db', emoji: '🍇' },
    { name: '西瓜', radius: 80, score: 100,color: '#2ed573', emoji: '🍉' } // 終極目標！
];

let currentScore = 0;
let currentMode = 'login'; // 'login' 或 'register'
let currentUser = null;
let nextFruitIndex = 0;

// ==================== 2. 使用者系統（模擬後端） ====================
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
        if (db[user]) {
            msg.innerText = "❌ 帳號已存在！"; return;
        }
        db[user] = { password: pass, highscore: 0 };
        localStorage.setItem('fruit_game_users', JSON.stringify(db));
    } else {
        if (!db[user] || db[user].password !== pass) {
            msg.innerText = "❌ 帳號或密碼錯誤！"; return;
        }
    }

    // 登入成功
    currentUser = user;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    document.getElementById('current-user-tag').innerText = user;
    
    updateLeaderboardView();
    initGame(); // 啟動遊戲
}

function logout() {
    location.reload(); // 最快最乾淨的登出方式
}

function updateLeaderboardView() {
    let db = JSON.parse(localStorage.getItem('fruit_game_users')) || {};
    let players = Object.keys(db).map(username => ({
        username: username,
        highscore: db[username].highscore || 0
    }));

    // 依照分數由高到低排序
    players.sort((a, b) => b.highscore - a.highscore);

    const listHtml = document.getElementById('leaderboard-list');
    listHtml.innerHTML = players.slice(0, 5).map(p => 
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
    const width = 450;
    const height = 750;

    // 1. 建立物理引擎
    engine = Matter.Engine.create({ gravity: { y: 1.5 } }); // 稍微加重重力讓下落更乾脆
    
    // 2. 建立畫布渲染器
    render = Matter.Render.create({
        element: container,
        engine: engine,
        options: {
            width: width,
            height: height,
            wireframes: false, // 關閉線框，才會顯示我們設定的顏色
            background: 'transparent'
        }
    });
    Matter.Render.run(render);

    // 3. 執行引擎
    runner = Matter.Runner.create();
    Matter.Runner.run(runner, engine);

    // 4. 建立箱子邊界 (地板、左牆、右牆)
    const wallOptions = { isStatic: true, render: { fillStyle: '#e55039' } };
    const ground = Matter.Bodies.rectangle(width/2, height - 20, width, 40, wallOptions);
    const leftWall = Matter.Bodies.rectangle(10, height/2, 20, height, wallOptions);
    const rightWall = Matter.Bodies.rectangle(width - 10, height/2, 20, height, wallOptions);
    Matter.Composite.add(engine.world, [ground, leftWall, rightWall]);

    // 隨機決定下一個要出現的水果預覽 (限定只會掉落前三種小水果)
    rollNextFruit();

    // 5. 監聽玩家點擊畫布事件（放開手指/滑鼠時掉落）
    render.canvas.addEventListener('click', (e) => {
        if (!isReadyToDrop) return;

        // 計算點擊的 X 座標並限制在箱子內
        const rect = render.canvas.getBoundingClientRect();
        let clickX = e.clientX - rect.left;
        if (clickX < 30) clickX = 30;
        if (clickX > width - 30) clickX = width - 30;

        dropFruit(clickX);
    });

    // 6. 監聽碰撞事件（觸發合成邏輯）
    Matter.Events.on(engine, 'collisionStart', (event) => {
        const pairs = event.pairs;
        pairs.forEach(pair => {
            const bodyA = pair.bodyA;
            const bodyB = pair.bodyB;

            // 確保碰在一起的兩個物體都是水果，且等級相同
            if (bodyA.fruitLevel !== undefined && bodyB.fruitLevel !== undefined) {
                if (bodyA.fruitLevel === bodyB.fruitLevel) {
                    const currentLevel = bodyA.fruitLevel;

                    // 如果已經是最高等的西瓜，就不再升級，直接給獎勵分
                    if (currentLevel >= FRUIT_TYPES.length - 1) return;

                    // 計算碰撞的中心點，作為新水果的誕生位置
                    const midX = (bodyA.position.x + bodyB.position.x) / 2;
                    const midY = (bodyA.position.y + bodyB.position.y) / 2;

                    // 1. 消除舊水果
                    Matter.Composite.remove(engine.world, [bodyA, bodyB]);

                    // 2. 加分：依據合成出來的新水果等級給分（體積越大分數越高！）
                    const nextLevel = currentLevel + 1;
                    currentScore += FRUIT_TYPES[nextLevel].score;
                    document.getElementById('score').innerText = currentScore;

                    // 3. 生成新等級的水果
                    spawnFruit(midX, midY, nextLevel);
                    
                    // 4. 順便檢查是否觸發遊戲結束 (如果堆太高，這裡先簡單判定 Y 軸)
                    if(midY < 120) {
                        handleGameOver();
                    }
                }
            }
        });
    });
}

function rollNextFruit() {
    nextFruitIndex = Math.floor(Math.random() * 3); // 0, 1, 2 (草莓、檸檬、橘子)
    document.getElementById('next-fruit-preview').innerText = FRUIT_TYPES[nextFruitIndex].emoji;
}

function dropFruit(x) {
    isReadyToDrop = false;

    // 在玩家點擊的 X 位置頂端 (Y=80) 產生剛剛預玩的水果
    spawnFruit(x, 80, nextFruitIndex);

    // 隨機搖出再下一個水果
    rollNextFruit();

    // 防止玩家連點的冷卻時間 (0.5秒)
    setTimeout(() => {
        isReadyToDrop = true;
    }, 500);
}

function spawnFruit(x, y, level) {
    const config = FRUIT_TYPES[level];
    
    // 建立圓形物理體
    const fruit = Matter.Bodies.circle(x, y, config.radius, {
        restitution: 0.3, // 稍微帶點彈性
        friction: 0.1,
        render: {
            fillStyle: config.color // 水果顏色
        }
    });

    // 在物體上綁定我們自訂的標籤，方便碰撞時辨識
    fruit.fruitLevel = level;

    Matter.Composite.add(engine.world, fruit);
}

function handleGameOver() {
    // 簡單的判定：當有合成發生在頂部時觸發
    // 實務上可以做一條虛擬紅線，超過 3 秒才死，這邊先做即時結算
    saveScore(currentScore);
    alert(`👻 遊戲結束！你的得分是：${currentScore} 分`);
    logout();
}