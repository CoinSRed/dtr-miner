// ==========================================
// DTR MINER - REAL FRONTEND
// ==========================================

const tg = window.Telegram?.WebApp;

if (tg) {
    tg.ready();
    tg.expand();

    try {
        tg.setHeaderColor("#080b18");
        tg.setBackgroundColor("#080b18");
    } catch (error) {
        console.warn("Telegram theme setup failed:", error);
    }
}

// ------------------------------------------
// State
// ------------------------------------------

let appState = {
    user: null,
    miners: [],
    tasks: [],
    mining: false,
    miningStartedAt: null,
    currentRate: 0
};

let refreshTimer = null;


// ------------------------------------------
// Telegram Authentication
// ------------------------------------------

function getTelegramInitData() {
    if (!tg) {
        throw new Error("Telegram WebApp is not available");
    }

    const initData = tg.initData;

    if (!initData) {
        throw new Error(
            "Telegram authentication data is missing. Open DTR Miner from Telegram."
        );
    }

    return initData;
}


// ------------------------------------------
// API Helper
// ------------------------------------------

async function api(url, options = {}) {
    const initData = getTelegramInitData();

    const headers = {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": initData,
        ...(options.headers || {})
    };

    const response = await fetch(url, {
        ...options,
        headers
    });

    let data = null;

    try {
        data = await response.json();
    } catch {
        throw new Error("Invalid server response");
    }

    if (!response.ok) {
        throw new Error(data.error || "Server request failed");
    }

    return data;
}


// ------------------------------------------
// Helpers
// ------------------------------------------

function formatDTR(value) {
    const number = Number(value || 0);

    if (!Number.isFinite(number)) {
        return "0.00";
    }

    return number.toFixed(2);
}


function showMessage(message) {
    if (tg && tg.showPopup) {
        tg.showPopup({
            title: "DTR Miner",
            message: String(message),
            buttons: [
                {
                    type: "ok"
                }
            ]
        });
    } else {
        alert(message);
    }
}


function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}


// ------------------------------------------
// Load User
// ------------------------------------------

async function loadUser() {
    const data = await api("/api/me");

    appState.user = data.user || data;

    updateUserUI();

    return appState.user;
}


// ------------------------------------------
// Update User UI
// ------------------------------------------

function updateUserUI() {
    const user = appState.user;

    if (!user) {
        return;
    }

    const username = user.username
        ? `@${user.username}`
        : "@user";

    const firstName = user.first_name || "DTR Miner";

    const balance = Number(user.balance || 0);
    const totalMined = Number(user.total_mined || 0);
    const referrals = Number(user.referrals_count || 0);
    const minerLevel = Number(user.miner_level || 1);

    setText("headerUsername", username);
    setText("userName", firstName);

    setText("balance", formatDTR(balance));
    setText("totalBalance", formatDTR(balance));
    setText("totalMined", formatDTR(totalMined));

    setText("referrals", referrals);
    setText("referralCount", referrals);

    setText("level", minerLevel);

    setText(
        "profileName",
        firstName
    );

    setText(
        "profileUsername",
        username
    );

    setText(
        "profileBalance",
        `${formatDTR(balance)} DTR`
    );

    setText(
        "profileLevel",
        minerLevel
    );

    setText(
        "profileReferrals",
        referrals
    );

    updateMiningUI();
}


// ------------------------------------------
// Mining UI
// ------------------------------------------

function updateMiningUI() {
    const user = appState.user;

    if (!user) {
        return;
    }

    const active = Boolean(user.mining_active);

    appState.mining = active;
    appState.miningStartedAt = user.mining_started_at || null;

    const button = document.getElementById("miningButton");
    const status = document.getElementById("miningStatus");

    if (active) {
        if (status) {
            status.textContent = "Mining";
        }

        if (button) {
            button.textContent = "Mining...";
            button.disabled = true;
        }
    } else {
        if (status) {
            status.textContent = "Not Mining";
        }

        if (button) {
            button.textContent = "Start Mining";
            button.disabled = false;
        }
    }
}


// ------------------------------------------
// Start Mining
// ------------------------------------------

async function startMining() {
    try {
        const button = document.getElementById("miningButton");

        if (button) {
            button.disabled = true;
            button.textContent = "Starting...";
        }

        const data = await api("/api/mining/start", {
            method: "POST",
            body: JSON.stringify({})
        });

        if (data.user) {
            appState.user = data.user;
        }

        await loadUser();

        startMiningTimer();

    } catch (error) {
        console.error(error);

        showMessage(
            error.message || "Unable to start mining"
        );

        updateMiningUI();
    }
}


// ------------------------------------------
// Claim Mining
// ------------------------------------------

async function claimMining() {
    try {
        const data = await api("/api/mining/claim", {
            method: "POST",
            body: JSON.stringify({})
        });

        if (data.user) {
            appState.user = data.user;
        }

        await loadUser();

        stopMiningTimer();

        showMessage(
            `Mining claimed successfully.\n+${formatDTR(data.earned || 0)} DTR`
        );

    } catch (error) {
        console.error(error);

        showMessage(
            error.message || "Unable to claim mining"
        );
    }
}


// ------------------------------------------
// Mining Timer
// ------------------------------------------

function startMiningTimer() {
    stopMiningTimer();

    updateMiningTimer();

    refreshTimer = setInterval(() => {
        updateMiningTimer();
    }, 1000);
}


function stopMiningTimer() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}


function updateMiningTimer() {
    if (!appState.user?.mining_active) {
        return;
    }

    const started = new Date(
        appState.user.mining_started_at
    ).getTime();

    if (!Number.isFinite(started)) {
        return;
    }

    const elapsedSeconds = Math.max(
        0,
        Math.floor((Date.now() - started) / 1000)
    );

    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor(
        (elapsedSeconds % 3600) / 60
    );
    const seconds = elapsedSeconds % 60;

    const timer =
        `${String(hours).padStart(2, "0")}:` +
        `${String(minutes).padStart(2, "0")}:` +
        `${String(seconds).padStart(2, "0")}`;

    setText("miningTimer", timer);

    // Existing UI has a progress bar.
    // We use a 2-hour visual cycle.
    const maxSeconds = 2 * 60 * 60;

    const progress = Math.min(
        100,
        (elapsedSeconds / maxSeconds) * 100
    );

    const progressBar =
        document.getElementById("miningProgress");

    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }

    // Automatically refresh the server state periodically.
    if (elapsedSeconds % 30 === 0) {
        loadUser().catch(console.error);
    }
}


// ------------------------------------------
// Load Miners
// ------------------------------------------

async function loadMiners() {
    try {
        const data = await api("/api/miners");

        appState.miners = data.miners || data || [];

        renderMiners();

    } catch (error) {
        console.error("Failed to load miners:", error);
    }
}


// ------------------------------------------
// Render Miners
// ------------------------------------------

function renderMiners() {
    const container =
        document.querySelector("#page-miners");

    if (!container || !Array.isArray(appState.miners)) {
        return;
    }

    const existingCards =
        container.querySelectorAll(".miner-card");

    if (!existingCards.length) {
        return;
    }

    // Keep the existing HTML design for now.
    // Backend data is loaded and available in appState.miners.
}


// ------------------------------------------
// Buy Miner
// ------------------------------------------

async function buyMiner(level) {
    try {
        const data = await api("/api/miners/buy", {
            method: "POST",
            body: JSON.stringify({
                minerLevel: Number(level)
            })
        });

        if (data.user) {
            appState.user = data.user;
        }

        await loadUser();
        await loadMiners();

        showMessage(
            data.message ||
            "Miner purchased successfully"
        );

    } catch (error) {
        console.error(error);

        showMessage(
            error.message || "Unable to buy miner"
        );
    }
}


// ------------------------------------------
// Load Tasks
// ------------------------------------------

async function loadTasks() {
    try {
        const data = await api("/api/tasks");

        appState.tasks = data.tasks || data || [];

        renderTasks();

    } catch (error) {
        console.error("Failed to load tasks:", error);
    }
}


// ------------------------------------------
// Render Tasks
// ------------------------------------------

function renderTasks() {
    const list =
        document.getElementById("tasksList");

    if (!list || !Array.isArray(appState.tasks)) {
        return;
    }

    list.innerHTML = "";

    appState.tasks.forEach(task => {
        const card = document.createElement("div");

        card.className = "task-card";

        const completed = Boolean(task.completed);

        card.innerHTML = `
            <div class="task-left">
                <div class="task-icon">📋</div>

                <div>
                    <h3>${escapeHTML(task.title || "Task")}</h3>
                    <p>+${formatDTR(task.reward)} DTR</p>
                </div>
            </div>

            <button
                class="task-button"
                onclick="completeTask(${Number(task.id)})"
                ${completed ? "disabled" : ""}
            >
                ${completed ? "Completed" : "Claim"}
            </button>
        `;

        list.appendChild(card);
    });
}


// ------------------------------------------
// Complete Task
// ------------------------------------------

async function completeTask(taskId) {
    try {
        const data = await api("/api/tasks/claim", {
            method: "POST",
            body: JSON.stringify({
                taskId: Number(taskId)
            })
        });

        if (data.user) {
            appState.user = data.user;
        }

        await loadUser();
        await loadTasks();

        showMessage(
            data.message ||
            `Task completed.\n+${formatDTR(data.reward || 0)} DTR`
        );

    } catch (error) {
        console.error(error);

        showMessage(
            error.message || "Unable to complete task"
        );
    }
}


// ------------------------------------------
// Referral
// ------------------------------------------

function getReferralLink() {
    const botUsername = "DTR_Mining_Bot";

    const userId =
        appState.user?.telegram_id ||
        appState.user?.id;

    if (!userId) {
        return `https://t.me/${botUsername}`;
    }

    return `https://t.me/${botUsername}?start=ref_${userId}`;
}


async function copyReferral() {
    try {
        const link = getReferralLink();

        await navigator.clipboard.writeText(link);

        showMessage(
            "Referral link copied!"
        );

    } catch (error) {
        console.error(error);

        showMessage(
            getReferralLink()
        );
    }
}


// ------------------------------------------
// Withdraw
// ------------------------------------------

async function withdrawDTR() {
    showMessage(
        "Withdrawals are not active yet.\n\n" +
        "The TON withdrawal system will be connected after " +
        "the DTR Jetton and treasury are configured."
    );
}


// ------------------------------------------
// Navigation
// ------------------------------------------

function openPage(pageName, button) {
    const pages =
        document.querySelectorAll(".page");

    pages.forEach(page => {
        page.classList.remove("active");
    });

    const target =
        document.getElementById(`page-${pageName}`);

    if (target) {
        target.classList.add("active");
    }

    const navItems =
        document.querySelectorAll(".nav-item");

    navItems.forEach(item => {
        item.classList.remove("active");
    });

    if (button) {
        button.classList.add("active");
    }

    if (pageName === "tasks") {
        loadTasks();
    }

    if (pageName === "miners") {
        loadMiners();
    }

    if (pageName === "friends") {
        loadUser();
    }

    if (pageName === "profile") {
        loadUser();
    }
}


// ------------------------------------------
// HTML Escape
// ------------------------------------------

function escapeHTML(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ------------------------------------------
// Initial App Load
// ------------------------------------------

async function initializeApp() {
    try {
        if (!tg || !tg.initData) {
            throw new Error(
                "Please open DTR Miner from Telegram."
            );
        }

        await loadUser();
        await loadMiners();
        await loadTasks();

        if (appState.user?.mining_active) {
            startMiningTimer();
        }

        console.log("DTR Miner initialized successfully");

    } catch (error) {
        console.error(
            "DTR Miner initialization failed:",
            error
        );

        showMessage(
            error.message ||
            "Unable to connect to DTR Miner server."
        );
    }
}


// ------------------------------------------
// Start
// ------------------------------------------

document.addEventListener(
    "DOMContentLoaded",
    initializeApp
);