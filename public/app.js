const tg = window.Telegram.WebApp;

tg.ready();
tg.expand();

try {
    tg.setHeaderColor("#070707");
    tg.setBackgroundColor("#050505");
} catch (e) {
    console.log("Telegram UI color setup skipped");
}


let currentUser = null;
let currentMiner = null;
let miningInterval = null;
let miningStartTime = null;
let miningRate = 0;


/* =========================
   HELPERS
========================= */

function formatDTR(value) {
    const number = Number(value || 0);

    return number.toFixed(6);
}

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}

function getTelegramInitData() {
    return tg.initData || "";
}

async function api(url, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": getTelegramInitData(),
        ...(options.headers || {})
    };

    const response = await fetch(url, {
        ...options,
        headers
    });


            const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.error || "Request failed"
        );
    }

    return data;
}

function showMessage(message) {
    if (tg.showAlert) {
        tg.showAlert(message);
    } else {
        alert(message);
    }
}


/* =========================
   USER
========================= */

async function loadReferrals() {
    try {
        const data = await api("/api/referrals");

        setText(
            "referralCount",
            data.referrals || 0
        );

        setText(
            "referralTotalReward",
            `${formatDTR(data.total_reward || 0)} DTR`
        );

        const list =
            document.getElementById("friendsList");

        if (!list) return;

        if (!data.friends || data.friends.length === 0) {
            list.innerHTML = `
                <div class="empty-friends">
                    No friends yet.
                </div>
            `;
            return;
        }

        list.innerHTML = data.friends.map(friend => {
            const name = escapeHTML(
                friend.first_name ||
                (friend.username
                    ? `@${friend.username}`
                    : "DTR User")
            );

            const joinedDate = friend.created_at
                ? new Date(friend.created_at).toLocaleDateString()
                : "Unknown date";

            return `
                <div class="friend-item">
                    <div class="friend-info">
                        <div class="friend-name">
                            ${name}
                        </div>

                        <div class="friend-status">
                            <span class="status-dot"></span>
                            Connected
                        </div>

                        <div class="friend-date">
                            Joined ${joinedDate}
                        </div>
                    </div>

                    <div class="friend-reward">
                        +${formatDTR(friend.reward)} DTR
                    </div>
                </div>
            `;
        }).join("");

    } catch (error) {
        console.error(
            "Unable to load referrals:",
            error
        );
    }
}

async function loadUser() {
    try {

         const data =
    await api("/api/me");

        currentUser = data.user;
        currentMiner = data.miner;

        updateUserUI();
        loadReferrals();

        if (
            currentUser.mining_active &&
            currentUser.mining_started_at
        ) {
            startMiningTimer(
                currentUser.mining_started_at
            );
        }
    } catch (error) {
        console.error(error);

        showMessage(
            "Unable to load your DTR account."
        );
    }
}

function updateUserUI() {
    if (!currentUser) return;

    const username =
        currentUser.username
            ? `@${currentUser.username}`
            : "@user";

    const name =
        currentUser.first_name ||
        "DTR Miner";

    setText("headerUsername", username);
    setText("userName", name);

    setText(
        "balance",
        formatDTR(currentUser.balance)
    );

    setText(
        "totalBalance",
        formatDTR(currentUser.total_mined)
    );

    setText(
        "level",
        currentUser.miner_level
    );

    setText(
        "referrals",
        currentUser.referrals_count
    );

    setText(
        "referralCount",
        currentUser.referrals_count
    );

    setText("profileName", name);
    setText("profileUsername", username);

    setText(
        "profileBalance",
        `${formatDTR(currentUser.balance)} DTR`
    );

    setText(
        "profileLevel",
        currentUser.miner_level
    );

    setText(
        "profileReferrals",
        currentUser.referrals_count
    );

    if (currentMiner) {
        miningRate =
            Number(currentMiner.rate_per_hour);

        setText(
            "miningRate",
            `${formatDTR(miningRate)} DTR / hour`
        );
    }

    updateMiningButton();
}


/* =========================
   MINING
========================= */

function updateMiningButton() {
    const button =
        document.getElementById("miningButton");

    const status =
        document.getElementById("miningStatus");

    const icon =
        document.getElementById("miningIcon");

    if (!button || !status) return;

    if (currentUser?.mining_active) {

        status.textContent = "Mining Active";

        button.innerHTML =
            "<span>⚡</span> CLAIM DTR";

        button.onclick = claimMining;

        if (icon) {
            icon.classList.add("active");
        }

    } else {

        status.textContent = "Not Mining";

        button.innerHTML =
            "<span>⛏</span> START MINING";

        button.onclick = startMining;

        if (icon) {
            icon.classList.remove("active");
        }
    }
}

async function startMining() {
    try {

                const data =
            await api("/api/mining/start", {
                method: "POST"
            });

        currentUser.mining_active = true;

        currentUser.mining_started_at =
            data.mining_started_at;

        updateMiningButton();

        startMiningTimer(
            data.mining_started_at
        );

        showMessage(
            "⛏️ Mining started!"
        );

    } catch (error) {
        showMessage(error.message);
    }
}

function startMiningTimer(startTime) {
    if (miningInterval) {
        clearInterval(miningInterval);
    }

    miningStartTime =
        new Date(startTime).getTime();

    const update = () => {

        if (!currentUser?.mining_active) {
            return;
        }

        const elapsed =
            Math.max(
                0,
                Date.now() - miningStartTime
            );

        const totalSeconds =
            Math.floor(elapsed / 1000);

        const hours =
            Math.floor(totalSeconds / 3600);

        const minutes =
            Math.floor(
                (totalSeconds % 3600) / 60
            );

        const seconds =
            totalSeconds % 60;

        const time =
            [
                hours,
                minutes,
                seconds
            ]
                .map(
                    n =>
                        String(n).padStart(2, "0")
                )
                .join(":");

        setText(
            "miningTimer",
            time
        );

        const earned =
            (miningRate / 3600) *
            (elapsed / 1000);

        const progress =
            Math.min(
                100,
                (earned / Math.max(miningRate, .000001)) *
                100
            );

        const progressElement =
            document.getElementById(
                "miningProgress"
            );

        if (progressElement) {
            progressElement.style.width =
                `${progress}%`;
        }
    };

    update();

    miningInterval =
        setInterval(update, 1000);
}

async function claimMining() {
    try {

                const data =
            await api("/api/mining/claim", {
                method: "POST"
            });

        currentUser.balance =
            data.balance;

        currentUser.total_mined =
            data.total_mined;

        currentUser.mining_active =
            false;

        currentUser.mining_started_at =
            null;

        if (miningInterval) {
            clearInterval(miningInterval);
            miningInterval = null;
        }

        setText(
            "miningTimer",
            "00:00:00"
        );

        const progress =
            document.getElementById(
                "miningProgress"
            );

        if (progress) {
            progress.style.width = "0%";
        }

        updateUserUI();

        showMessage(
            `You earned ${formatDTR(data.earned)} DTR`
        );

    } catch (error) {
        showMessage(error.message);
    }
}


/* =========================
   MINERS
========================= */

async function loadMiners() {
    try {

        const data =
            await api("/api/miners");

        renderMiners(data.miners || []);

    } catch (error) {
        console.error(error);
    }
}

function renderMiners(miners) {
    const container =
        document.getElementById("minersList");

    if (!container) return;

    container.innerHTML = "";

    miners.forEach((miner, index) => {

        const level =
            Number(miner.level);

        const price =
            Number(miner.price);

        const rate =
            Number(miner.rate_per_hour);

        let icon = "⛏️";

        if (index === 1) icon = "⚡";
        if (index === 2) icon = "🚀";
        if (index === 3) icon = "🔥";
        if (index === 4) icon = "💎";

        const current =
            currentUser &&
            level === Number(
                currentUser.miner_level
            );

        const unlocked =
            currentUser &&
            level < Number(
                currentUser.miner_level
            );

        const buttonText =
            current
                ? "ACTIVE"
                : unlocked
                    ? "OWNED"
                    : price === 0
                        ? "ACTIVE"
                        : "BUY";

        const card =
            document.createElement("div");

        card.className =
            `miner-card ${
                current ? "current" : ""
            }`;

        card.innerHTML = `
            <div class="miner-icon">
                ${icon}
            </div>

            <div class="miner-info">
                <h3>
                    ${escapeHTML(miner.name)}
                </h3>

                <p>
                    Mining power:
                    +${formatDTR(rate)} DTR/hour
                </p>

                <strong>
                    ${
                        price === 0
                            ? "FREE"
                            : `${formatDTR(price)} DTR`
                    }
                </strong>
            </div>

            <button
                class="miner-button ${
                    current ? "active" : ""
                }"
                ${
                    current || unlocked
                        ? "disabled"
                        : ""
                }
                onclick="buyMiner(${level})"
            >
                ${buttonText}
            </button>
        `;

        container.appendChild(card);
    });
}

async function buyMiner(level) {
    try {

        const data =
            await api("/api/miners/buy", {
                method: "POST",

                body: JSON.stringify({
                    miner_level: Number(level)
                })
            });

        currentUser.balance =
            data.balance;

        currentUser.miner_level =
            data.miner_level;

        updateUserUI();

        await loadMiners();

        showMessage(
            `Miner Level ${level} activated!`
        );

    } catch (error) {
        showMessage(error.message);
    }
}


/* =========================
   TASKS
========================= */

async function loadTasks() {
    try {

        const data =
            await api("/api/tasks");

        renderTasks(data.tasks || []);

    } catch (error) {
        console.error(error);
    }
}

function taskIcon(taskKey) {

    if (
        taskKey.includes("instagram")
    ) {
        return "◎";
    }

    if (
        taskKey.includes("telegram")
    ) {
        return "✈";
    }

    return "✓";
}

function getTaskURL(task) {

    if (
        task.task_key ===
        "instagram_junior_amin_67"
    ) {
        return "https://www.instagram.com/junior_amin_67/";
    }

    if (
        task.task_key ===
        "instagram_soufyan_101"
    ) {
        return "https://www.instagram.com/soufyan____101/";
    }

    if (
        task.task_key ===
        "telegram_dtr_channel"
    ) {
        return "https://t.me/+P2YKRQoaVaRmMWNk";
    }

    return null;
}

function renderTasks(tasks) {

    const container =
        document.getElementById(
            "tasksList"
        );

    if (!container) return;

    container.innerHTML = "";

    tasks.forEach(task => {

        const completed =
            Boolean(task.completed_at);

        const card =
            document.createElement("div");

        card.className =
            "task-card";

        card.innerHTML = `
            <div class="task-left">

                <div class="task-icon">
                    ${taskIcon(task.task_key)}
                </div>

                <div>

                    <h3>
                        ${escapeHTML(task.title)}
                    </h3>

                    <p>
                        +${formatDTR(task.reward)} DTR
                    </p>

                </div>

            </div>

            <button
                class="task-button ${
                    completed ? "done" : ""
                }"
                ${
                    completed
                        ? "disabled"
                        : ""
                }
                onclick="completeTask(${task.id})"
            >
                ${
                    completed
                        ? "✓ DONE"
                        : "OPEN"
                }
            </button>
        `;

        container.appendChild(card);
    });
}

async function completeTask(taskId) {

    const tasks =
        await api("/api/tasks");

    const task =
        (tasks.tasks || []).find(
            t => Number(t.id) === Number(taskId)
        );

    if (!task) return;

    if (task.completed_at) {
        showMessage(
            "You already completed this task."
        );

        return;
    }

    const url =
        getTaskURL(task);

    if (url) {

        try {
            tg.openLink(url);
        } catch {
            window.open(
                url,
                "_blank"
            );
        }
    }

    setTimeout(async () => {

        const confirmed =
            confirm(
                `Did you complete the task?\n\nReward: ${formatDTR(task.reward)} DTR`
            );

        if (!confirmed) {
            return;
        }

        try {


            const data =
                await api("/api/tasks/claim", {
                    method: "POST",

                    body: JSON.stringify({
                        task_id: Number(taskId)
                    })
                });

            currentUser.balance =
                data.balance;

            currentUser.total_mined =
                data.total_mined;

            updateUserUI();

            await loadTasks();

            showMessage(
                `+${formatDTR(data.reward)} DTR added!`
            );

        } catch (error) {
            showMessage(error.message);
        }

    }, 1200);
}


/* =========================
   REFERRAL
========================= */

async function copyReferral() {

    if (!currentUser) return;

    const botUsername =
        "DTR_Mining_Bot";

    const link =
        `https://t.me/${botUsername}?start=ref_${currentUser.telegram_id}`;

    try {

        await navigator.clipboard.writeText(
            link
        );

        showMessage(
            "Referral link copied!"
        );

    } catch {

        showMessage(link);
    }
}


/* =========================
   WITHDRAW
========================= */

async function withdrawDTR() {
    const amountInput =
        document.getElementById("withdrawAmount");

    const amount =
        amountInput
            ? parseFloat(amountInput.value)
            : NaN;

    if (!Number.isFinite(amount) || amount <= 0) {
        showMessage(
            "Please enter a valid DTR amount."
        );
        return;
    }

    if (amount < 4) {
        showMessage(
            "Minimum withdrawal is 4 DTR."
        );
        return;
    }

    const walletInput =
        document.getElementById("walletAddress");

    const wallet =
        walletInput
            ? walletInput.value.trim()
            : "";

    if (!wallet) {
        showMessage(
            "Please enter your wallet address."
        );
        return;
    }

    try {
        await api("/api/withdraw", {
            method: "POST",
            body: JSON.stringify({
                amount: amount,
                wallet_address: wallet
            })
        });

        currentUser.balance =
            Number(currentUser.balance) - amount;

        updateUserUI();

        amountInput.value = "";

        showMessage(
            "Withdrawal request submitted."
        );

    } catch (error) {
        showMessage(error.message);
    }
}


/* =========================
   NAVIGATION
========================= */

function openPage(page, button) {

    document
        .querySelectorAll(".page")
        .forEach(section => {
            section.classList.remove(
                "active"
            );
        });

    document
        .querySelectorAll(".nav-item")
        .forEach(item => {
            item.classList.remove(
                "active"
            );
        });

    const target =
        document.getElementById(
            `page-${page}`
        );

    if (target) {
        target.classList.add(
            "active"
        );
    }

    if (button) {
        button.classList.add(
            "active"
        );
    }

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

    if (page === "tasks") {
        loadTasks();
    }

    if (page === "miners") {
        loadMiners();
    }
}


/* =========================
   SECURITY / HTML
========================= */

function escapeHTML(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/* =========================
   START
========================= */

async function initialize() {

    if (!getTelegramInitData()) {

        console.warn(
            "Telegram initData is empty."
        );

        showMessage(
            "Please open DTR Miner from Telegram."
        );

        return;
    }

    await loadUser();

    await loadTasks();

    await loadMiners();
}

initialize();









/* =========================
   TON CONNECT
========================= */

let tonConnectUI = null;

async function initTonConnect() {
    try {
        if (typeof TON_CONNECT_UI === "undefined") {
            console.error("TON Connect library not loaded.");
            return;
        }

        tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
            manifestUrl: `${window.location.origin}/tonconnect-manifest.json`,
            buttonRootId: "ton-connect"
        });

        tonConnectUI.onStatusChange(async (wallet) => {
            if (!wallet) {
                console.log("TON wallet disconnected");
                return;
            }

            const walletAddress = wallet.account?.address;

            if (!walletAddress) {
                console.error("Wallet address not found.");
                return;
            }

            console.log("TON wallet connected:", walletAddress);

            try {
                const response = await api("/api/wallet", {
                    method: "POST",
                    body: JSON.stringify({
                        wallet_address: walletAddress
                    })
                });

                console.log("Wallet saved:", response);
            } catch (error) {
                console.error("Failed to save wallet:", error);
            }
        });

    } catch (error) {
        console.error("TON Connect initialization failed:", error);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initTonConnect();
});
