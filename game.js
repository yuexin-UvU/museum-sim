const GAME_CONFIG = {
    storageKey: 'museum-sim-save-v2',
    homeUnlockSavings: 100000,
    leisureLimitPerQuarter: 2,
    studyCourseCost: 5000,
    degreeTuition: 50000,
    programApplyMinSavings: 100000,
    adminDiceSuccessThreshold: 3,
    adminDiceMaxRolls: 10,
    adminDiceIntervalMs: 100,
    defaultAdminButtonText: '🎲 尝试甩锅 (Roll)',
    homeRestEffects: { health: 20, mood: 25 }
};

const UTILS = {
    rand: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
    randArr: (arr) => arr[Math.floor(Math.random() * arr.length)],
    clamp: (num, min, max) => Math.min(Math.max(num, min), max),
    clone: (value) => JSON.parse(JSON.stringify(value)),
    formatMoney: (val) => val >= 10000 ? (val/10000).toFixed(2) + "万" : Math.floor(val) + "元",
    getStatName: (k) => k==='money'?'公款':(k==='savings'?'存款':(k==='rep'?'声望':(k==='iq'?'智商':(k==='eq'?'情商':(k==='health'?'精力':(k==='mood'?'愉悦':k)))))),
    formatEffects(effects) {
        return Object.entries(effects).map(([key, value]) => {
            const label = this.getStatName(key);
            const displayValue = value > 0 ? `+${value}` : value;
            return `\n${label} ${displayValue}`;
        }).join('');
    }
};
// ==================== 事件管理器 ====================
const EventManager = {
    queue: [], // 事件队列
    // 触发季度末事件 (1-2个)
    triggerEndQuarter(game) {
        this.queue = []; // 清空旧队列
        const count = Math.random() < 0.5 ? 1 : 2; // 50%概率1个，50%概率2个
        // 1. 构建可用事件池
        let pool = ['life', 'audience', 'hall'];
        // 检查大学是否解锁 (假设 savings >= 10000 且智商 > 50 视为解锁了大学相关剧情，或者简单点，只要有钱就能触发)
        // 这里我们用一个简单判断：如果玩家智商 > 40，解锁学校事件
        if (game.state.player.iq >= 40) pool.push('school');
        for (let i = 0; i < count; i++) {
            const type = UTILS.randArr(pool);
            const category = RANDOM_EVENT_DB[type];
            // 50% 概率是被动，50% 是主动
            const isPassive = Math.random() < 0.5;
            const eventList = isPassive ? category.passive : category.active;
            const eventData = UTILS.randArr(eventList);
            this.queue.push({
                ...eventData,
                type: type,
                isPassive: isPassive
            });
        }
        // 开始处理队列
        this.processNext(game);
    },

    processNext(game) {
        if (this.queue.length === 0) return;
        const evt = this.queue.shift(); // 取出第一个
        if (evt.isPassive) {
            // 被动事件：直接结算并显示结果，点击关闭后处理下一个
            game.changeStat('money', evt.effect.money || 0); // 确保money变动被处理
            // 处理其他属性
            for(let k in evt.effect) {
                if(k !== 'money') game.changeStat(k, evt.effect[k]);
            }

            game.showModal(
                "📢 突发消息", 
                `${evt.desc}\n----------------${UTILS.formatEffects(evt.effect)}`, 
                [{
                    txt: "知道了",
                    cb: () => {
                        game.closeModal();
                        setTimeout(() => this.processNext(game), 300); // 延迟一点处理下一个
                    }
                }],
                true // 允许点击背景关闭
            );
            game.log("info", `[随机] ${evt.desc}`);
            game.updateUI();
        } else {
            // 主动事件：显示选项
            const choices = evt.choices.map(c => ({
                txt: c.txt,
                cb: () => {
                    game.closeModal();
                    // 结算效果
                    for(let k in c.effect) game.changeStat(k, c.effect[k]);
                    // 显示结果弹窗，结果弹窗关闭后，继续处理队列
                    game.showModal(
                        "事件结果", 
                        `${c.res}\n----------------${UTILS.formatEffects(c.effect)}`, 
                        [{
                            txt: "确定", 
                            cb: () => {
                                game.closeModal();
                                setTimeout(() => this.processNext(game), 300);
                            }
                        }], 
                        true
                    );
                    game.log("warning", `[抉择] ${evt.title}：${c.txt} -> ${c.res}`);
                    game.updateUI();
                }
            }));
            game.showModal(`❓ ${evt.title}`, evt.desc, choices);
        }
    }
};

const game = {
    state: null,
    history: null,
    isModalOpen: false, // 标记弹窗状态
    startGame() {
        document.getElementById('start-screen').style.display = 'none';
        document.getElementById('app').style.display = 'grid';
        if (this.restorePersistedGame()) return;
        this.init();
        this.showIntro();
    },

    init() {
        const edu = ["本科", "硕士"][Math.floor(Math.random()*2)];
        let baseRep = edu === "硕士" ? 5 : 0;
        const baseAge = edu === "硕士" ? 25 : 22;
        this.state = {
            player: {
                name: "",
                gender: "",
                edu: edu,
                eduStatus: "",
                age: baseAge,
                titleIdx: 0,
                health: 100, mood: 100,
                iq: Math.floor(Math.random()*11),
                eq: Math.floor(Math.random()*11),
                rep: baseRep,
                money: 130000,
                savings: 200
            },

            turn: { year: 1, quarter: 1 },

            limits: { leisure: GAME_CONFIG.leisureLimitPerQuarter },

            exhibitions: [],
            flags: {
                quartersInTitle: 0,
                researchApplied: false,
                researchSuccessCount: 0,
                hasAppliedExhibitThisQuarter: false,
                hasStudiedThisQuarter: false,
                promotedThisYear: false,
                didActionThisQuarter: false,
                isPanelLocked: false,
                currentAdminTask: null,
                adminTaskDone: false,
                
                // 【新增】作死计数器
                adminAfterExhibitStreak: 0, 
                // 【新增】本季度是否已经干过展览活了
                hasDoneExhibitTaskThisQuarter: false,
                hasRestedAtHomeThisQuarter: false
            },

            university: {
                isEnrolled: false,
                programType: null,
                targetCredits: 0,
                currentQuarters: 0,
                thesisProgress: 0,
                thesisUnlocked: false,
                isDelayed: false,
                activeCourseIds: [],
                courseProgress: {},

                courseCompleted: {},

                courseStartYear: {},

                selectedThisQuarter: false
            },

            settings: {
                theme: 'brutal'
            },

            meta: {
                introCompleted: false
            }
        };

        this.saveState();
        this.log("system", `🎉 欢迎入职！这里是您的工位。新的一年，请多关照！`);
        this.updateUI();
        this.generateAdminTask();
        this.renderExhibitPanel();
    },

    hasPersistedProgress() {
        return Boolean(this.readPersistedGame());
    },

    readPersistedGame() {
        try {
            const raw = localStorage.getItem(GAME_CONFIG.storageKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.state) return null;
            return parsed;
        } catch (error) {
            console.warn('读取自动存档失败', error);
            return null;
        }
    },

    normalizeLoadedState(rawState) {
        const state = UTILS.clone(rawState);
        if (!state.limits) state.limits = {};
        if (typeof state.limits.leisure !== 'number') {
            state.limits.leisure = GAME_CONFIG.leisureLimitPerQuarter;
        }

        if (!state.flags) state.flags = {};
        if (typeof state.flags.hasDoneExhibitTaskThisQuarter !== 'boolean') state.flags.hasDoneExhibitTaskThisQuarter = false;
        if (typeof state.flags.hasRestedAtHomeThisQuarter !== 'boolean') state.flags.hasRestedAtHomeThisQuarter = false;
        if (typeof state.flags.adminAfterExhibitStreak !== 'number') state.flags.adminAfterExhibitStreak = 0;

        if (!state.settings) state.settings = {};
        if (!state.settings.theme) state.settings.theme = 'brutal';

        if (!state.meta) state.meta = {};
        if (typeof state.meta.introCompleted !== 'boolean') {
            state.meta.introCompleted = Boolean(state.player && state.player.name);
        }

        return state;
    },

    applyThemeFromState() {
        const useBento = this.state && this.state.settings && this.state.settings.theme === 'bento';
        document.body.classList.toggle('theme-bento', useBento);
    },

    persistProgress() {
        if (!this.state) return;
        try {
            localStorage.setItem(GAME_CONFIG.storageKey, JSON.stringify({
                version: 2,
                state: this.state,
                history: this.history
            }));
        } catch (error) {
            console.warn('写入自动存档失败', error);
        }
    },

    clearPersistedProgress() {
        try {
            localStorage.removeItem(GAME_CONFIG.storageKey);
        } catch (error) {
            console.warn('清理自动存档失败', error);
        }
    },

    resetProgress() {
        this.clearPersistedProgress();
        location.reload();
    },

    updateStartScreen() {
        const startBtn = document.getElementById('btn-start');
        const startTip = document.getElementById('start-tip');
        if (!startBtn || !startTip) return;

        if (this.hasPersistedProgress()) {
            startBtn.innerText = '继续游戏';
            startTip.innerText = '检测到本地自动存档，点击后会恢复上次进度。';
            return;
        }

        startBtn.innerText = '开始游戏';
        startTip.innerText = '纯前端单机游戏，直接打开 index.html 即可游玩。';
    },

    restorePersistedGame() {
        const saved = this.readPersistedGame();
        if (!saved) return false;

        this.state = this.normalizeLoadedState(saved.state);
        this.history = saved.history ? this.normalizeLoadedState(saved.history) : UTILS.clone(this.state);
        this.applyThemeFromState();
        this.closeModal();
        this.closeOnboarding();
        this.updateUI();
        this.renderAdminTaskPanel();
        this.renderExhibitPanel();
        if (!this.state.meta.introCompleted) {
            this.showIntro();
            return true;
        }

        this.log("system", "💾 已恢复本地自动存档。");
        return true;
    },

    switchRightTab(tabName) {
        document.querySelectorAll('.right-tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.right-panel').forEach(panel => panel.classList.remove('active'));
        const btns = document.querySelectorAll('.right-tab-btn');
        if (tabName === 'admin') btns[0].classList.add('active');
        if (tabName === 'log') btns[1].classList.add('active');
        const panel = document.getElementById(`panel-${tabName}`);
        if (panel) panel.classList.add('active');
    },

    generateAdminTask() {
        this.state.flags.isPanelLocked = false;
        this.state.flags.adminTaskDone = false;
        const task = ADMIN_TASKS[Math.floor(Math.random() * ADMIN_TASKS.length)];
        this.state.flags.currentAdminTask = task;
        this.renderAdminTaskPanel();
        this.switchRightTab('admin');
        this.persistProgress();
    },

    renderAdminTaskPanel() {
        const task = this.state && this.state.flags ? this.state.flags.currentAdminTask : null;
        const chatBox = document.getElementById('admin-chat-box');
        if (chatBox) {
            chatBox.innerHTML = '';
            if (task) this.addChatMsg('leader', task.text);
            if (this.state.flags.adminTaskDone) {
                if (this.state.flags.isPanelLocked) {
                    if (task) this.addChatMsg('system', `❌ ${task.failDesc}`);
                    this.addChatMsg('system', '🔒 本季度展览工作面板已被锁定！');
                } else {
                    this.addChatMsg('system', '✅ 本季度行政任务已处理，可以继续推进展览工作。');
                }
            }
        }

        const btn = document.querySelector('.dice-btn');
        if (!btn) return;
        btn.disabled = this.state.flags.adminTaskDone;
        if (!this.state.flags.adminTaskDone) {
            btn.innerText = GAME_CONFIG.defaultAdminButtonText;
            return;
        }

        btn.innerText = this.state.flags.isPanelLocked ? '🎲 本季度已接活' : '🎲 本季度已处理';
    },

    addChatMsg(role, text) {
        const box = document.getElementById('admin-chat-box');
        if (!box) return;
        const div = document.createElement('div');
        div.className = `chat-msg ${role}`;
        const avatarTxt = role === 'leader' ? '领' : (role === 'player' ? '我' : '统');
        div.innerHTML = `<div class=\"avatar\">${avatarTxt}</div><div class=\"bubble\">${text}</div>`;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    },

    actionRollDice() {
        if (this.state.flags.adminTaskDone) return;
        const btn = document.querySelector('.dice-btn');
        if (!btn) return;
        btn.disabled = true;
        let rollCount = 0;
        const interval = setInterval(() => {
            const tempRoll = Math.floor(Math.random() * 6) + 1;
            btn.innerText = `🎲 判定中... ${tempRoll}`;
            rollCount++;
            if (rollCount >= GAME_CONFIG.adminDiceMaxRolls) {
                clearInterval(interval);
                this.resolveDiceResult();
            }
        }, GAME_CONFIG.adminDiceIntervalMs);
    },

    resolveDiceResult() {
        const baseRoll = Math.floor(Math.random() * 6) + 1;
        const finalRoll = baseRoll;
        const task = this.state.flags.currentAdminTask;
        this.state.flags.adminTaskDone = true;
        
        // 【新增】计算“先斩后奏”的连击数
        // 如果 flag 为 true，说明在掷骰子前已经点过展览任务了 -> 作死+1
        if (this.state.flags.hasDoneExhibitTaskThisQuarter) {
            if (this.state.flags.adminAfterExhibitStreak === undefined) this.state.flags.adminAfterExhibitStreak = 0;
            this.state.flags.adminAfterExhibitStreak++;
        } else {
            // 如果很乖，是先回消息再干活的，计数清零
            this.state.flags.adminAfterExhibitStreak = 0;
        }
        const btn = document.querySelector('.dice-btn');
        this.persistProgress();
        if (finalRoll >= GAME_CONFIG.adminDiceSuccessThreshold) {
            this.addChatMsg('player', `（掷出 ${finalRoll}）领导，这事儿我不熟啊，要不让隔壁小李去？他擅长这个。`);
            setTimeout(() => {
                this.addChatMsg('leader', '行吧行吧，那你忙你的展览去。');
                this.log('success', '🎲 甩锅成功！你避开了繁琐的行政任务。');
                this.persistProgress();
            }, 800);
            if (btn) btn.innerText = `🎲 判定 ${finalRoll} (成功)`;
            return;
        }
        this.state.flags.isPanelLocked = true;
        this.addChatMsg('player', `（掷出 ${finalRoll}）好的领导...我马上办...（内心崩溃）`);
        setTimeout(() => {
            if (task) this.addChatMsg('system', `❌ 任务失败：${task.failDesc}`);
            this.addChatMsg('system', '🔒 本季度展览工作面板已被锁定！');
            this.log('danger', `🎲 甩锅失败 (点数${finalRoll})，被迫处理行政任务，展览进度停滞。`);
            this.renderExhibitPanel();
            this.persistProgress();
        }, 800);
        if (btn) btn.innerText = `🎲 判定 ${finalRoll} (失败)`;
    },

    saveState() { this.history = UTILS.clone(this.state); },

    markAction() { this.state.flags.didActionThisQuarter = true; },

    undoQuarter() {
        if (!this.history) return;
        this.state = UTILS.clone(this.history);
        this.applyThemeFromState();
        this.log("system", "↺ 时光倒流...回到了季度初，一切重新开始。");
        this.updateUI();
        this.renderAdminTaskPanel();
        this.renderExhibitPanel();
    },

nextQuarter() {
        // 1. 定义核心结算流程 (包含发工资、随机事件、生成新任务等)
        const proceedEndQuarter = () => {
            this.saveState();
            this.changeStat('money', 30000);
            this.log("success", "💰 季度经费已到账 (+30000)。");
            
            const sal = (TITLES[this.state.player.titleIdx] && TITLES[this.state.player.titleIdx].salary) || 0;
            const quarterSalary = sal * 3;
            if (quarterSalary > 0) {
                this.changeStat('savings', quarterSalary);
                this.log("success", `💵 工资已发放：${UTILS.formatMoney(quarterSalary)}（已入个人存款）`);
            }
            
            EventManager.triggerEndQuarter(this);
            if (this.state.turn.quarter === 4 && this.state.flags.researchApplied) this.settleResearch();
            
            this.state.exhibitions.forEach(ex => {
                ex.quartersActive++;
                if (ex.status === 'waiting') {
                    ex.feedbackTimer--;
                    if (ex.feedbackTimer <= 0) {
                        ex.status = 'ready_for_feedback';
                        this.log("success", `📬 [${ex.name}] 的观众反馈报告送到了您的案头，请查阅。`);
                    }
                }
            });

            const prevYear = this.state.turn.year;
            this.state.turn.quarter++;
            this.state.flags.quartersInTitle++;
            // === 【修改】年份更替与退休判定 ===
            if (this.state.turn.quarter > 4) {
                this.state.turn.year++;
                this.state.turn.quarter = 1;
                this.state.player.age += 1; // 年龄+1
                this.state.flags.researchApplied = false;
                this.state.flags.promotedThisYear = false;

                // 【新增】退休结局判定
                const p = this.state.player;
                // 设定退休年龄：女60，男(及其他)65
                const retireAge = p.gender === '女' ? 60 : 65; 
                
                if (p.age >= retireAge) {
                    const finalTitle = TITLES[p.titleIdx].name;
                    this.endGame(
                        "结局·光荣退休",
                        `🎉 光荣退休！\n\n你坚守到岗位的最后一刻，一生完成了无数展览。\n现在可以好好休息，享受退休生活了。\n\n----------------\n🎖️ 最终职称：【${finalTitle}】\n💰 退休存款：${UTILS.formatMoney(p.savings)}`
                    );
                    return; // 阻止后续逻辑，直接结束
                }
            }

            const didYearAdvance = this.state.turn.year !== prevYear;
            this.updateUniversityQuarter(didYearAdvance);
            
            // 结局判定：庸碌一生
            if (this.state.turn.year === 4 && this.state.turn.quarter === 1 && this.state.player.titleIdx === 0) {
                this.endGame(
                    "结局·庸碌一生",
                    "你始终认真对待每一项工作，也付出了足够的努力。\n然而，认同与回报始终没有如期而至。\n在漫长的消耗中，你逐渐放下了改变现状的期待。\n最终，你选择按部就班地生活，等待时间慢慢流走。\n这并非失败，只是另一种选择。"
                );
                return;
            }

            this.state.limits.leisure = GAME_CONFIG.leisureLimitPerQuarter;
            this.state.flags.hasAppliedExhibitThisQuarter = false;
            this.state.flags.hasStudiedThisQuarter = false;
            this.state.flags.didActionThisQuarter = false;
            this.state.flags.hasRestedAtHomeThisQuarter = false;
            
            // 生成新任务
            this.generateAdminTask(); 
            
            // 重置作死标记
            this.state.flags.hasDoneExhibitTaskThisQuarter = false;

            // 判定“领导的不满” (连续3次先斩后奏)
            if (this.state.flags.adminAfterExhibitStreak >= 3 && Math.random() < 0.5) {
                this.changeStat('mood', -10);
                this.state.flags.isPanelLocked = true;
                this.state.flags.adminAfterExhibitStreak = 0;
                this.showModal(
                    "😡 领导的不满", 
                    "领导在例会上点名批评了你：\n“有些人啊，工作分不清主次！消息也不回，在那瞎忙什么？”\n\n【后果】\n💔 愉悦 -10\n🔒 下季度展览面板已被强制锁定（整顿职场作风）",
                    [{txt: "忍气吞声", cb: () => this.closeModal()}]
                );
                this.log("danger", "被领导针对了：因不懂“规矩”，本季度展览工作被暂停。");
            }

            if (this.checkSurvival()) return;
            this.log("turn", `📅 Y${this.state.turn.year} - Q${this.state.turn.quarter}`);
            this.updateUI();
            this.renderExhibitPanel();
        };

        // 2. 定义检查流程 (行政检查 -> 空操作检查 -> 执行结算)
        const runChecks = () => {
            // [检查] 行政任务是否完成
            const isFirstTurn = this.state.turn.year === 1 && this.state.turn.quarter === 1;
            if (!isFirstTurn && !this.state.flags.adminTaskDone) {
                this.showResult("无法下班", "本季度的【行政任务】还未处理！\n请先点击右侧栏的【掷骰子】回复领导消息。");
                this.switchRightTab('admin');
                return;
            }

            // [检查] 是否空操作
            if (!this.state.flags.didActionThisQuarter) {
                this.showModal(
                    "提醒",
                    "本季度你没有任何操作，记得安排工作或提升自己。",
                    [{
                        txt: "继续进入下一季度",
                        cb: () => {
                            this.closeModal();
                            proceedEndQuarter();
                        }
                    }, {
                        txt: "返回本季度",
                        cb: () => this.closeModal()
                    }],
                    true
                );
                return;
            }

            // 一切正常，执行结算
            proceedEndQuarter();
        };

        // 3. 【新增】精力值检查 (最优先触发)
        if (this.state.player.health <= 0) {
            this.showModal(
                "准备下班",
                "同事拦住你：“你看起来没什么精神，脸色惨白，要不喝个咖啡再回家？”\n\n(⚠️ 精力值已耗尽，强行下班可能直接触发【过劳死】结局)",
                [
                    { 
                        txt: "去买咖啡", 
                        cb: () => { 
                            this.closeModal(); 
                            this.switchScene('office'); // 帮你切回办公室找商店
                        } 
                    },
                    { 
                        txt: "坚持下班", 
                        cb: () => { 
                            this.closeModal(); 
                            runChecks(); // 玩家头铁，继续执行后续检查
                        } 
                    }
                ],
                true
            );
            return;
        }

        // 4. 精力正常，直接跑检查
        runChecks();
    },
    // 结果弹窗 (通知类，可点击背景关闭)
    showResult(msg, effects) {
       // ====== 修复代码开始 ======
        // 1. 如果传入的是纯文字说明（比如经费不足的提示），直接显示，不进行属性计算
        if (typeof effects === 'string') {
            this.showModal("提示", `${msg}\n\n${effects}`, [{txt:"知道了", cb:()=>this.closeModal()}], true);
            return;
        }
        // ====== 修复代码结束 ======
        for (let k in effects) {
            this.changeStat(k, effects[k]);
        }
        // true 表示这是通知类弹窗，允许点击背景关闭
        this.showModal("事件结果", `${msg}\n----------------${UTILS.formatEffects(effects)}`, [{txt:"知道了", cb:()=>this.closeModal()}], true);
        this.updateUI();
    },
    // [新增] 检查某个展览的某阶段是否解锁
    checkPhaseUnlocked(ex, phase) {
        if (phase === 1) return true; // 第一阶段永远解锁
        // 检查上一阶段的所有任务是否都已完成 (>=100)
        const prevPhaseTasks = Object.keys(EX_TASKS).filter(k => EX_TASKS[k].phase === phase - 1);
        const allDone = prevPhaseTasks.every(k => ex.tasks[k] >= 100);
        return allDone;
    },
    // [新增] 检查展览是否因为死线到了而失败
    checkDeadline(ex) {
        if (ex.status !== 'active') return;
        // 如果时间到了 (deadline <= 0) 且任务没做完
        const allFinished = Object.keys(ex.tasks).every(k => ex.tasks[k] >= 100);
        if (ex.deadline <= 0 && !allFinished) {
            ex.status = 'failed';
            this.showResult(`❌ 展览事故！`, { rep: -20, mood: -20 });
            this.log("danger", `☠️ [${ex.name}] 因工期延误未能开展，造成了严重的教学事故！`);
        }
    },

    actionApplyExhibit() {
        this.markAction();
        // 逻辑：如果不是第一年第一季度，且行政任务没做完，则禁止申请
        const isFirstTurn = this.state.turn.year === 1 && this.state.turn.quarter === 1;
        if (!isFirstTurn && !this.state.flags.adminTaskDone) {
            this.showResult("流程卡住了", "领导的消息还没回呢！\n请先处理右侧栏的【行政任务】（掷骰子），否则无法审批新项目。");
            this.switchRightTab('admin'); // 贴心地自动切过去
            return;
        }
        if (this.state.flags.isPanelLocked) {
            this.showResult("面板锁定", "本季度行政任务繁忙，无法推进展览工作。");
            return;
        }
        if (this.state.flags.hasAppliedExhibitThisQuarter) {
            this.showResult("申请受限", "本季度申请额度已用完，请下个季度再来。");
            return;
        }

        const currentNames = this.state.exhibitions.map(e => e.name);
        const pool = EX_THEMES.filter(t => !currentNames.includes(t));
        if (this.state.exhibitions.filter(e=>e.status!=='finished').length >= 2) {
            this.showResult("任务过载", "您手头已经有两个项目在推进了，请先完成手头工作！");
            return;
        }

        const options = [];
        for(let i=0; i<3 && pool.length>0; i++) {
            const idx = Math.floor(Math.random()*pool.length);
            options.push(pool[idx]);
            pool.splice(idx, 1);
        }

        const choices = options.map(t => ({
            txt: t,
            cb: () => {
                this.state.exhibitions.push({
                    id: Date.now(),
                    name: t,
                    status: 'active',
                    deadline: Math.floor(Math.random() * 3) + 3, // 随机 3-5 个季度
                    tasks: { collect:0, read:0, trip:0, theme:0, items:0, design:0, souvenir:0 },

                    feedbackTimer: 0,
                    quartersActive: 0
                });
                this.state.flags.hasAppliedExhibitThisQuarter = true;
                this.log("system", `📝 新项目 [${t}] 已成功立项。`);
                this.closeModal();
                this.renderExhibitPanel();
            }
        }));
        this.showModal("立项申请", "请选择本季度重点推进的展览项目：", choices);
    },

    actionExhibitTask(id, key) {
        this.markAction();
        
        // 【新增】记录：玩家在处理行政任务前，先处理了展览任务
        if (!this.state.flags.adminTaskDone) {
            this.state.flags.hasDoneExhibitTaskThisQuarter = true;
        }

        if (this.state.flags.isPanelLocked) {
            this.showResult("面板锁定", "本季度行政任务繁忙，无法推进展览工作。");
            return;
        }
        if (this.state.player.health <= 10) {
            this.showResult("精力预警", "🚑 您的精力状况极差，无法进行高强度工作！请务必先休息。");
            return;
        }

        const ex = this.state.exhibitions.find(e => e.id === id);
        const task = EX_TASKS[key];
        if (this.state.player.money < task.cost) {
            this.showResult("经费不足", `该工作需要 ${UTILS.formatMoney(task.cost)}，当前部门经费不足。`);
            return;
        }
        // 获取该展览、该阶段的所有潜在事件
        let stageEvents = (CURATION_EVENTS[ex.name] && CURATION_EVENTS[ex.name][key]) || null;
        if (stageEvents && stageEvents.length > 0) {
            // === 新逻辑：随机抽取一个剧情事件 ===
            const evt = stageEvents[Math.floor(Math.random() * stageEvents.length)];
            // 兼容新旧两种数据格式
            let title, desc, choices;
            if (evt.choices) { 
                // 新格式：包含标题、描述、选项数组
                title = evt.title;
                desc = evt.desc; // 这里会显示您写的长描述
                choices = evt.choices.map(c => ({
                    txt: c.txt, // 这里会显示您写的选项文本
                    cb: () => {
                        // 扣除经费并应用选项效果
                        this.finishTask(ex, key, task.cost, c.effect, c.res || "事件已处理");
                    }
                }));
            } else {
                // 旧格式兼容
                title = `推进：${task.name}`;
                desc = "在推进过程中，请选择处理方案：";
                choices = stageEvents.map(e => ({
                    txt: e.txt,
                    cb: () => this.finishTask(ex, key, task.cost, e.effect, e.res)
                }));
            }

            this.showModal(title, desc, choices);
        } else {
            // 默认通用保底事件
            this.showModal(`推进：${task.name}`, `即将消耗经费 ${UTILS.formatMoney(task.cost)}，是否确认执行？`, [{
                txt: "确认执行",
                cb: () => this.finishTask(ex, key, task.cost, {health:-5}, "工作已完成")
            }]);
        }
    },

    finishTask(ex, key, cost, effect, resText) {
        // 扣除经费
        this.changeStat('money', -cost);
        // 应用子事件效果 (包含动态精力扣除)
        // 展览工作：每个选项固定消耗 10-15 精力，其余只影响 mood
        let appliedEffect = {};

        const workCost = -UTILS.rand(10, 15);
        appliedEffect.health = workCost;
        if (effect && typeof effect === 'object') {
            if (effect.mood !== undefined) {
                const v = effect.mood;
                const capped = Math.sign(v) * Math.min(Math.abs(v), 5);
                if (capped !== 0) { appliedEffect.mood = capped; }
            }
        }

        const progress = Math.floor(Math.random()*51) + 50;
        ex.tasks[key] = Math.min(100, ex.tasks[key] + progress);
        this.closeModal();
        // 只展示并记录实际生效的健康/愉悦变化
        this.showResult(resText, Object.keys(appliedEffect).length ? appliedEffect : "无明显变化");
        // 周报故事化
        let story = EX_TASKS[key].story || `完成了${EX_TASKS[key].name}工作。`;
        this.log("system", `🔨 [${ex.name}] ${story} (进度+${progress}%)`);
        if (Object.values(ex.tasks).every(v => v >= 100)) {
            ex.status = 'waiting';
            ex.feedbackTimer = 1;
            this.log("success", `🎉 恭喜！[${ex.name}] 的筹备工作已全部完成，等待开展！`);
        }

        this.renderExhibitPanel();
    },

    actionViewFeedback(id) {
        this.markAction();
        const ex = this.state.exhibitions.find(e => e.id === id);
        const isRushJob = ex.quartersActive <= 4;
        const isBadReview = isRushJob && Math.random() > 0.5;
        let content = isBadReview ? "【差评反馈】观众反映动线混乱，细节粗糙，看来欲速则不达。" : "【好评反馈】展览广受好评，学术界与公众都给予了高度评价！";
        let effects = isBadReview ? { rep: -5 } : { rep: 10 };

        this.showModal("观众反馈", content, [{
            txt: "归档项目",
            cb: () => {
                this.closeModal();
                this.showResult(isBadReview?"声望受损":"声望大幅提升", effects);
                this.state.exhibitions = this.state.exhibitions.filter(e => e.id !== id);
                this.renderExhibitPanel();
            }
        }]);
    },

    actionShop(type) {
        this.markAction();
        if (type === 'coffee') {
            // [修改] 检查存款 savings
            if (this.state.player.savings < 50) { 
                this.showResult("囊中羞涩", "你的【个人存款】不足，买不起咖啡了..."); 
                return; 
            }

            let hAdd = Math.floor(Math.random()*6)+5;
            let mAdd = Math.floor(Math.random()*6)+5;
            // [修改] 扣除存款 savings
            this.changeStat('savings', -50);
            this.showResult("喝了一杯特浓咖啡", {health: hAdd, mood: mAdd});
            this.log("system", "☕ 花50元私房钱喝了杯咖啡，心情变好了。");
        } else {
            // [修改] 检查存款 savings
            if (this.state.player.savings < 100) { 
                this.showResult("囊中羞涩", "你的【个人存款】不足，吃不起套餐..."); 
                return; 
            }

            let hAdd = Math.floor(Math.random()*6)+10;
            let mAdd = Math.floor(Math.random()*5)+8;
            // [修改] 扣除存款 savings
            this.changeStat('savings', -100);
            this.showResult("享用了文创套餐", {health: hAdd, mood: mAdd});
            this.log("system", "🍱 花100元私房钱吃了顿好的，充满力量！");
        }
    },

    getIqEqCaps() {
        const p = this.state && this.state.player ? this.state.player : null;
        const max = p && p.edu === "博士" ? 120 : 100;
        if (p && p.titleIdx === 4) {
            return { min: 101, max: 120 };
        }

        return { min: 0, max: max };
    },

    changeStat(key, val) {
        this.state.player[key] += val;
        if (key === 'health' || key === 'mood') {
            this.state.player[key] = UTILS.clamp(this.state.player[key], 0, 100);
        }

        if (key === 'iq' || key === 'eq') {
            const caps = this.getIqEqCaps();
            this.state.player[key] = UTILS.clamp(this.state.player[key], caps.min, caps.max);
        }

        if(key === 'money' || key === 'savings') this.state.player[key] = Math.max(0, this.state.player[key]);
    },

    updateUI() {
        const p = this.state.player;
        document.getElementById('ui-name').innerText = p.name;
        document.getElementById('ui-edu').innerText = p.eduStatus ? p.eduStatus : p.edu;
        const ageEl = document.getElementById('ui-age');
        if (ageEl) ageEl.innerText = p.age;
        document.getElementById('ui-title').innerText = TITLES[p.titleIdx].name;
        document.getElementById('ui-iq').innerText = p.iq;
        document.getElementById('ui-eq').innerText = p.eq;
        document.getElementById('ui-rep').innerText = p.rep;
        document.getElementById('ui-money').innerText = UTILS.formatMoney(p.money);
        // [新增] 更新存款显示
        if(document.getElementById('ui-savings')) document.getElementById('ui-savings').innerText = UTILS.formatMoney(p.savings);
        document.getElementById('txt-health').innerText = p.health;
        document.getElementById('bar-health').style.width = p.health+"%";
        document.getElementById('txt-mood').innerText = p.mood;
        document.getElementById('bar-mood').style.width = p.mood+"%";
        document.getElementById('limit-leisure').innerText = `${this.state.limits.leisure}/${GAME_CONFIG.leisureLimitPerQuarter}`;
        document.getElementById('ui-year').innerText = this.state.turn.year;
        document.getElementById('ui-quarter').innerText = this.state.turn.quarter;
        document.getElementById('btn-promote').disabled = !(this.state.turn.quarter === 4 && !this.state.flags.promotedThisYear && p.titleIdx < 4);
        const degreeBtn = document.getElementById('btn-degree');
        const degreeTitle = document.getElementById('degree-title');
        const degreeDesc = document.getElementById('degree-desc');
        if (degreeBtn && degreeTitle && degreeDesc) {
            if (p.edu === "本科") {
                degreeTitle.innerText = `申请在职硕士 (${UTILS.formatMoney(GAME_CONFIG.degreeTuition)})`;
                degreeDesc.innerText = "晋升学历 (本科可申请)";
                degreeBtn.disabled = false;
            } else if (p.edu === "硕士") {
                degreeTitle.innerText = `申请在职博士 (${UTILS.formatMoney(GAME_CONFIG.degreeTuition)})`;
                degreeDesc.innerText = "晋升学历 (需硕士学位)";
                degreeBtn.disabled = false;
            } else {
                degreeTitle.innerText = "已获博士学位";
                degreeDesc.innerText = "无需再申请";
                degreeBtn.disabled = true;
            }
        }

        const btnRes = document.getElementById('btn-research');
        document.getElementById('research-count').innerText = `${this.state.flags.researchSuccessCount}/5`;
        if (this.state.turn.quarter === 1 && !this.state.flags.researchApplied && this.state.flags.researchSuccessCount < 5) {
            btnRes.disabled = false;
            document.getElementById('research-msg').innerText = "窗口期开启";
            document.getElementById('research-msg').style.color = "var(--success)";
        } else {
            btnRes.disabled = true;
            document.getElementById('research-msg').innerText = this.state.flags.researchApplied ? "等待评审" : "窗口关闭";
            document.getElementById('research-msg').style.color = "var(--text-sub)";
        }
        this.renderHomePanel();
        this.renderUniversityUI();
        this.persistProgress();
    },
    renderHomePanel() {
        const unlocked = this.state.player.savings >= GAME_CONFIG.homeUnlockSavings;
        const homeTab = document.getElementById('tab-home');
        const placeholder = document.querySelector('#view-home .scene-placeholder');
        const homeContent = document.getElementById('home-content');
        if (homeTab) homeTab.classList.toggle('locked', !unlocked);
        if (!placeholder || !homeContent) return;

        placeholder.classList.toggle('hidden', unlocked);
        homeContent.classList.toggle('hidden', !unlocked);

        if (!unlocked) {
            placeholder.innerHTML = `
                <div class="scene-icon">🔒</div>
                <h3>温馨小窝</h3>
                <p>这里是你心灵的港湾。</p>
                <p style="color:var(--danger); margin-top:10px">解锁条件：个人存款达到 ${UTILS.formatMoney(GAME_CONFIG.homeUnlockSavings)}</p>
            `;
            return;
        }

        const rested = this.state.flags.hasRestedAtHomeThisQuarter;
        const effects = GAME_CONFIG.homeRestEffects;
        homeContent.innerHTML = `
            <div class="home-panel">
                <div class="home-panel-title">温馨小窝</div>
                <div class="home-panel-copy">回到家之后，工作群终于安静了。每个季度都可以在这里彻底喘一口气。</div>
                <div class="home-rest-summary">每季度可休息一次：精力 +${effects.health}，愉悦 +${effects.mood}</div>
                <button class="primary" onclick="game.actionHomeRest()" ${rested ? 'disabled' : ''}>${rested ? '本季度已回家休息' : '回家休息'}</button>
            </div>
        `;
    },
    // [新增] 切换中间栏场景
    switchScene(sceneName) {
        // 1. 检查家庭解锁条件
        if (sceneName === 'home') {
            if (this.state.player.savings < GAME_CONFIG.homeUnlockSavings) {
                this.showResult("未解锁", `买房首付还没攒够呢！(需要存款≥${UTILS.formatMoney(GAME_CONFIG.homeUnlockSavings)})`);
                return;
            }
        }
        // 2. 切换 UI 显示
        document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
        const target = document.getElementById(`view-${sceneName}`);
        if (target) target.classList.add('active');
        // 3. 更新 Tab 样式
        document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
        const tab = document.getElementById(`tab-${sceneName}`);
        if (tab && !tab.classList.contains('locked')) tab.classList.add('active');
    },
    // [新增] 大学进修逻辑 (框架)
    actionStudy(type) {
        this.markAction();
        if (type === 'course') {
            if (this.state.flags.hasStudiedThisQuarter) {
                this.showResult("进修受限", "本季度只能进修课程一次，请下个季度再来。");
                return;
            }

            if (this.state.player.savings < GAME_CONFIG.studyCourseCost) {
                this.showResult("存款不足", "学费不够，还是先去搬砖吧。");
                return;
            }

            const courses = [
                {
                    title: "博物馆管理与运营",
                    feedback: "你进修了海旦大学的博物馆管理与运营课程，受益匪浅。"
                },
                {
                    title: "文物保护与修复",
                    feedback: "你进修了南衡文保学院的文物保护与修复课程，对专业规范有了更深理解。"
                },
                {
                    title: "CAD建模课程",
                    feedback: "你进修了维界学院的CAD建模课程，开始理解空间表达的技术逻辑。"
                },
                {
                    title: "数字博物馆建设",
                    feedback: "你进修了那江大学的数字博物馆建设课程，思考工作中更多的可能性。"
                },
                {
                    title: "博物馆教育设计",
                    feedback: "你进修了青原大学的博物馆教育设计课程，对观众体验更加敏感。"
                }
            ];
            const choices = courses.map((course) => ({
                txt: course.title,
                cb: () => {
                    this.closeModal();
                    this.changeStat('savings', -GAME_CONFIG.studyCourseCost);
                    this.changeStat('health', -10);
                    this.changeStat('mood', -10);
                    this.state.flags.hasStudiedThisQuarter = true;
                    this.showResult(course.feedback, { iq: 5, rep: 3 });
                    this.log("success", `🎓 进修完成：${course.title}`);
                    this.updateUI();
                }
            }));
            this.showModal("选择进修课程", "请从以下课程中选择一门进修：", choices);
            return;
        } else if (type === 'degree') {
            const p = this.state.player;
            const cost = GAME_CONFIG.degreeTuition;
            if (p.edu === "本科") {
                if (p.savings < cost) {
                    this.showResult("存款不足", "学费不够，先攒点钱吧。");
                    return;
                }

                this.changeStat('savings', -cost);
                p.edu = "硕士";
                this.showResult("在职硕士毕业", { rep: 5 });
                this.log("success", "🎓 在职硕士毕业，声望+5。");
            } else if (p.edu === "硕士") {
                if (p.savings < cost) {
                    this.showResult("存款不足", "学费不够，先攒点钱吧。");
                    return;
                }

                this.changeStat('savings', -cost);
                p.edu = "博士";
                this.showResult("在职博士毕业", "学历已晋升为博士。");
                this.log("success", "🎓 在职博士毕业，学历晋升为博士。");
            } else {
                this.showResult("已是博士", "您已经拥有博士学位，无需再次申请。");
            }
        }

        this.updateUI();
    },

    showIntro() {
        const inputId = "player-name-input";
        const genderName = "player-gender";
        const randomName = () => NAME_DB[Math.floor(Math.random() * NAME_DB.length)];
        const content = [
            '<div class="intro-wrap">',
            '<div class="intro-title">欢迎入职！</div>',
            '<div class="intro-row">',
            '<div class="intro-label">你的名字</div>',
            '<div class="intro-name-grid">',
            `<input id="${inputId}" type="text" class="intro-input" placeholder="输入姓名">`,
            '<button type="button" id="intro-random" class="intro-random-btn">随机姓名</button>',
            '</div>',
            '</div>',
            '<div class="intro-row">',
            '<div class="intro-label">选择性别</div>',
            `<select id="gender-select" name="${genderName}" class="intro-select">`,
            '<option value="男">男</option>',
            '<option value="女">女</option>',
            '<option value="其他">其他</option>',
            '</select>',
            '</div>',
            '<div class="intro-row">',
            '<div class="intro-label">风格选择</div>',
            '<div class="intro-style-switch">',
            '<button type="button" id="style-bento" class="intro-style-btn">摸鱼不被抓版</button>',
            '<button type="button" id="style-brutal" class="intro-style-btn active">活泼版</button>',
            '</div>',
            '</div>',
            '</div>'
        ].join('');
        this.showModal(
            "入职信息",
            content,
            [{
                txt: "开始入职",
                cb: () => {
                    const input = document.getElementById(inputId);
                    const rawName = input && input.value.trim() ? input.value.trim() : randomName();
                    const finishIntro = (finalName) => {
                        const genderSelect = document.getElementById("gender-select");
                        const gender = genderSelect && genderSelect.value ? genderSelect.value : "\u5176\u4ed6";
                        this.state.player.name = finalName;
                        this.state.player.gender = gender;
                        const useBento = btnBento && btnBento.classList.contains('active');
                        this.state.settings.theme = useBento ? 'bento' : 'brutal';
                        this.state.meta.introCompleted = true;
                        this.applyThemeFromState();
                        this.closeModal();
                        this.updateUI();
                        this.showGuide();
                    };

                    const blockedName = "\u90ed\u60a6\u6b46";
                    const loveName1 = "\u6234\u5b50\u5764";
                    const loveName2 = "\u5446\u5b50\u56f0";
                    const willingName = "\u8d75\u709c\u7433";
                    if (rawName === blockedName) {
                        const fallback = randomName();
                        this.showModal(
                            "\u63d0\u793a",
                            "\u4f60\u624d\u4e0d\u662f\u90ed\u60a6\u6b46\uff01\uff01",
                            [{ txt: "\u7ee7\u7eed", cb: () => finishIntro(fallback) }],
                            true
                        );
                        return;
                    }

                    if (rawName === loveName1 || rawName === loveName2) {
                        this.showModal(
                            "\u63d0\u793a",
                            "LOVE\u2764",
                            [{ txt: "\u7ee7\u7eed", cb: () => finishIntro(rawName) }],
                            true
                        );
                        return;
                    }

                    if (rawName === willingName) {
                        this.showModal(
                            "\u63d0\u793a",
                            "Hello\uff0cWilling!!",
                            [{ txt: "\u7ee7\u7eed", cb: () => finishIntro(rawName) }],
                            true
                        );
                        return;
                    }

                    finishIntro(rawName);
                }
            }]
        );
        const box = document.querySelector('.modal-box');
        const btnBento = document.getElementById('style-bento');
        const btnBrutal = document.getElementById('style-brutal');
        const btnRandom = document.getElementById('intro-random');
        const setStyle = (style) => {
            if (!box) return;
            box.classList.toggle('intro-style-bento', style === 'bento');
            box.classList.toggle('intro-style-brutal', style === 'brutal');
            if (btnBento) btnBento.classList.toggle('active', style === 'bento');
            if (btnBrutal) btnBrutal.classList.toggle('active', style === 'brutal');
        };

        if (box) box.classList.add('intro-modal');
        if (btnBento) btnBento.addEventListener('click', () => setStyle('bento'));
        if (btnBrutal) btnBrutal.addEventListener('click', () => setStyle('brutal'));
        if (btnRandom) btnRandom.addEventListener('click', () => {
            const input = document.getElementById(inputId);
            if (input) input.value = randomName();
        });
        setStyle('brutal');
    },

    getUniversityCourseById(id) {
        return UNIVERSITY_COURSES.find(c => c.id === id) || null;
    },

    getUniversityEarnedCredits() {
        const uni = this.state.university;
        return UNIVERSITY_COURSES.reduce((sum, c) => sum + (uni.courseCompleted[c.id] ? c.credits : 0), 0);
    },

    renderUniversityUI() {
        const statusEl = document.getElementById('university-status');
        const actionsEl = document.getElementById('university-actions');
        const coursesEl = document.getElementById('university-courses');
        const thesisEl = document.getElementById('university-thesis');
        if (!statusEl || !actionsEl || !coursesEl || !thesisEl) return;
        const uni = this.state.university;
        const p = this.state.player;
        const earned = this.getUniversityEarnedCredits();
        const isQ2 = this.state.turn.quarter === 2;
        if (!uni.isEnrolled) {
            statusEl.innerHTML = `
                <div class="scene-icon">🎓</div>
                <h3>学术深造中心</h3>
                <p>在这里攻读更高学位，提升基础智商上限。</p>
                <div style="margin-top:20px; width:100%">
                    <button class="primary" id="btn-study-course" style="width:100%; padding:15px; margin-bottom:10px" onclick="game.actionStudy('course')">
                        参加进修课程 (${UTILS.formatMoney(GAME_CONFIG.studyCourseCost)})<br>
                        <span style="font-size:0.8em; opacity:0.8">-精力10 -愉悦10</span>
                    </button>
                    <button id="btn-apply-program" class="primary" style="width:100%; padding:15px;" ${isQ2 ? "" : "disabled"}>
                        申请在读硕士
                    </button>
                </div>
            `;
            actionsEl.innerHTML = "";
        } else {
            const programName = uni.programType === 'PhD' ? '博士' : '硕士';
            const delayTag = uni.isDelayed ? "<span class=\"university-pill\">延毕</span>" : "";
            statusEl.innerHTML = `
                当前状态：在读${programName}${delayTag}<br>
                学分进度：${earned} / ${uni.targetCredits}<br>
                已修季度：${uni.currentQuarters}
            `;
            actionsEl.innerHTML = `
                <button class="primary" id="btn-select-courses" ${uni.selectedThisQuarter ? "disabled" : ""}>本季度选课</button>
                <button class="primary" id="btn-write-thesis" ${uni.thesisUnlocked ? "" : "disabled"}>撰写论文</button>
                <button class="primary" id="btn-graduate">申请毕业</button>
            `;
        }

        const applyProgram = document.getElementById('btn-apply-program');
        const selectCourses = document.getElementById('btn-select-courses');
        const writeThesis = document.getElementById('btn-write-thesis');
        const graduate = document.getElementById('btn-graduate');
        if (applyProgram) {
            const target = p.edu === "硕士" ? "PhD" : "Master";
            applyProgram.innerText = p.edu === "硕士" ? "申请在读博士" : "申请在读硕士";
            applyProgram.onclick = () => this.openEnrollment(target);
        }

        if (selectCourses) selectCourses.onclick = () => this.openCourseSelection();
        if (writeThesis) writeThesis.onclick = () => this.writeThesis();
        if (graduate) graduate.onclick = () => this.tryGraduate();
        if (!uni.isEnrolled) {
            coursesEl.innerHTML = "<div class=\"university-course-meta\">未入学</div>";
            thesisEl.innerHTML = "<div class=\"university-course-meta\">论文尚未开启</div>";
            return;
        }

        if (uni.activeCourseIds.length === 0) {
            coursesEl.innerHTML = "<div class=\"university-course-meta\">本季度尚未选课</div>";
        } else {
            coursesEl.innerHTML = uni.activeCourseIds.map(id => {
                const course = this.getUniversityCourseById(id);
                if (!course) return "";
                const progress = uni.courseProgress[id] || 0;
                const done = uni.courseCompleted[id];
                const statusText = done ? "已修完" : `进度 ${progress}/4`;
                const disabled = done ? "disabled" : "";
                return `
                    <div class="university-course-card">
                        <div class="university-course-title">${course.name}</div>
                        <div class="university-course-intro">${course.intro}</div>
                        <div class="university-course-meta">学分：${course.credits}｜${statusText}</div>
                        <div class="university-course-actions">
                            <button ${disabled} onclick="game.attendCourse(${course.id})">上课</button>
                            <button ${disabled} onclick="game.hireSubstitute(${course.id})">代课</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        if (!uni.thesisUnlocked) {
            thesisEl.innerHTML = "<div class=\"university-course-meta\">论文任务尚未开启（第二年起开启）。</div>";
        } else {
            thesisEl.innerHTML = `
                <div class="university-course-meta">论文进度：${uni.thesisProgress}%</div>
                <div class="bar-track"><div class="bar-fill" style="width:${uni.thesisProgress}%; background:var(--primary)"></div></div>
            `;
        }
    },

    openEnrollment(type) {
        const isQ2 = this.state.turn.quarter === 2;
        if (!isQ2) {
            this.showResult("申请受限", "仅限每年 Q2 申请入学。");
            return;
        }

        if (this.state.player.iq <= 10 || this.state.player.eq <= 10 || this.state.player.savings < GAME_CONFIG.programApplyMinSavings) {
            this.showResult("条件不足", `申请在读硕士/博士需智商与情商 > 10，且存款 ≥ ${UTILS.formatMoney(GAME_CONFIG.programApplyMinSavings)}。`);
            return;
        }

        const p = this.state.player;
        if (type === 'Master') {
            if (p.edu === "硕士" || p.edu === "博士") {
                this.showResult("无需申请", "你已拥有硕士及以上学位。");
                return;
            }
        }

        if (type === 'PhD') {
            if (p.edu !== "硕士") {
                this.showResult("条件不足", "申请博士需先获得硕士学位。");
                return;
            }
        }

        this.applyEnrollment(type);
    },

    applyEnrollment(type) {
        const uni = this.state.university;
        if (uni.isEnrolled) {
            this.showResult("已在读", "当前已有在读学位，请先完成学业。");
            return;
        }

        uni.isEnrolled = true;
        uni.programType = type;
        uni.targetCredits = type === 'PhD' ? 36 : 32;
        uni.currentQuarters = 0;
        uni.thesisProgress = 0;
        uni.thesisUnlocked = false;
        uni.isDelayed = false;
        uni.activeCourseIds = [];
        uni.courseProgress = {};

        uni.courseCompleted = {};

        uni.courseStartYear = {};

        uni.selectedThisQuarter = false;
        this.state.player.eduStatus = type === 'PhD' ? "在读博士" : "在读硕士";
        const degreeLabel = type === 'PhD' ? "博士" : "硕士";
        this.showResult(
            "录取成功",
            `你成功申请上了南京大学博物馆专业的非全日制专业${degreeLabel}，尽情享受校园生活，注意不要挂科哦！`
        );
        this.updateUI();
    },

    openCourseSelection() {
        const uni = this.state.university;
        if (!uni.isEnrolled) {
            this.showResult("未入学", "请先申请在读学位。");
            return;
        }

        if (uni.selectedThisQuarter) {
            this.showResult("选课完成", "本季度已完成选课。");
            return;
        }

        const carryover = uni.activeCourseIds.length;
        const slots = 3 - carryover;
        if (slots <= 0) {
            this.showResult("选课受限", "本季度课程已满，请先完成在修课程。");
            uni.selectedThisQuarter = true;
            this.renderUniversityUI();
            return;
        }

        const available = UNIVERSITY_COURSES.filter(c => !uni.courseCompleted[c.id] && !uni.activeCourseIds.includes(c.id));
        if (available.length < slots) {
            this.showResult("选课受限", "可选课程不足，请先完成已选课程。");
            return;
        }

        const listHtml = available.map(c =>
            `<label style="display:block; margin-bottom:6px;">` +
            `<input type="checkbox" class="uni-course-check" value="${c.id}">` +
            `${c.name}（${c.credits}学分）` +
            `</label>`
        ).join('');
        this.showModal(
            "本季度选课",
            `<div style="text-align:left">${listHtml}</div>`,
            [{
                txt: "确认选课",
                cb: () => {
                    const selected = Array.from(document.querySelectorAll('.uni-course-check:checked')).map(el => Number(el.value));
                    if (selected.length !== slots) {
                        this.showResult("选课失败", `本季度需选择 ${slots} 门课程。`);
                        return;
                    }

                    uni.activeCourseIds = uni.activeCourseIds.concat(selected);
                    selected.forEach(id => { uni.courseStartYear[id] = this.state.turn.year; });
                    uni.selectedThisQuarter = true;
                    this.closeModal();
                    this.updateUI();
                }
            }],
            true
        );
    },

    attendCourse(courseId) {
        const uni = this.state.university;
        if (!uni.activeCourseIds.includes(courseId)) {
            this.showResult("未选课程", "该课程不在本季度选课中。");
            return;
        }

        if (uni.courseCompleted[courseId]) {
            this.showResult("课程已修完", "请选择其他课程。");
            return;
        }

        if (this.state.player.health < 5 || this.state.player.mood < 8) {
            this.showResult("状态不足", "精力(5)或愉悦(8)不足，无法上课。");
            return;
        }

        this.markAction();
        this.changeStat('health', -5);
        this.changeStat('mood', -8);
        uni.courseProgress[courseId] = (uni.courseProgress[courseId] || 0) + 1;
        if (uni.courseProgress[courseId] >= 4) {
            uni.courseProgress[courseId] = 4;
            uni.courseCompleted[courseId] = true;
            uni.activeCourseIds = uni.activeCourseIds.filter(id => id !== courseId);
            delete uni.courseStartYear[courseId];
            const course = this.getUniversityCourseById(courseId);
            this.showResult("课程完成", `【${course.name}】修读完成，获得 ${course.credits} 学分。`);
        } else {
            const course = this.getUniversityCourseById(courseId);
            this.showResult("课程进度", `【${course.name}】进度更新：${uni.courseProgress[courseId]}/4`);
        }

        this.updateUI();
    },

    hireSubstitute(courseId) {
        const uni = this.state.university;
        if (!uni.activeCourseIds.includes(courseId)) {
            this.showResult("未选课程", "该课程不在本季度选课中。");
            return;
        }

        if (uni.courseCompleted[courseId]) {
            this.showResult("课程已修完", "请选择其他课程。");
            return;
        }

        if (this.state.player.savings < 1000) {
            this.showResult("存款不足", "存款不足 1000 元，无法雇佣代课。");
            return;
        }

        this.markAction();
        this.changeStat('savings', -1000);
        const caught = Math.random() < 0.2;
        const course = this.getUniversityCourseById(courseId);
        if (caught) {
            uni.courseProgress[courseId] = 0;
            this.showResult(`代课被抓\n【${course.name}】课程进度清零，声望 -10。`, { rep: -10 });
        } else {
            uni.courseProgress[courseId] = (uni.courseProgress[courseId] || 0) + 1;
            if (uni.courseProgress[courseId] >= 4) {
                uni.courseProgress[courseId] = 4;
                uni.courseCompleted[courseId] = true;
                uni.activeCourseIds = uni.activeCourseIds.filter(id => id !== courseId);
                delete uni.courseStartYear[courseId];
                this.showResult("代课成功", `【${course.name}】修读完成，获得 ${course.credits} 学分。`);
            } else {
                this.showResult("代课成功", `【${course.name}】进度更新：${uni.courseProgress[courseId]}/4`);
            }
        }

        this.updateUI();
    },

    updateUniversityQuarter(didYearAdvance) {
        const uni = this.state.university;
        if (!uni.isEnrolled) return;
        uni.currentQuarters += 1;
        uni.selectedThisQuarter = false;
        if (uni.currentQuarters === 5) {
            uni.thesisUnlocked = true;
            this.showResult("论文开启", "第二学年开始，毕业论文任务已开启。");
        }

        const maxQuarters = uni.programType === 'PhD' ? 16 : 12;
        if (uni.currentQuarters > maxQuarters && !uni.isDelayed) {
            uni.isDelayed = true;
            this.state.player.eduStatus = (uni.programType === 'PhD' ? "在读博士" : "在读硕士") + "（延毕）";
            this.showResult("延毕提醒", "标准修读时间已过，进入延毕状态。");
        }

        if (didYearAdvance) {
            const currentYear = this.state.turn.year;
            const nextActive = [];
            uni.activeCourseIds.forEach(id => {
                if (uni.courseCompleted[id]) {
                    delete uni.courseStartYear[id];
                    return;
                }
                const startYear = uni.courseStartYear[id];
                if (startYear && startYear < currentYear) {
                    uni.courseProgress[id] = 0;
                    delete uni.courseStartYear[id];
                    return;
                }

                nextActive.push(id);
            });
            uni.activeCourseIds = nextActive;
        }
    },

    writeThesis() {
        const uni = this.state.university;
        if (!uni.isEnrolled) {
            this.showResult("未入学", "请先申请在读学位。");
            return;
        }

        if (!uni.thesisUnlocked) {
            this.showResult("尚未开启", "论文任务尚未开启（第二年开始）。");
            return;
        }

        if (uni.thesisProgress >= 100) {
            this.showResult("论文完成", "论文已完成，无需继续。");
            return;
        }

        if (this.state.player.health < 15 || this.state.player.mood < 10) {
            this.showResult("状态不足", "精力(15)或愉悦(10)不足，无法写论文。");
            return;
        }

        this.markAction();
        this.changeStat('health', -15);
        this.changeStat('mood', -10);
        const inc = uni.programType === 'PhD' ? 10 : 20;
        uni.thesisProgress = Math.min(100, uni.thesisProgress + inc);
        this.showResult("论文进度", `论文进度提升至 ${uni.thesisProgress}%`);
        this.updateUI();
    },

    checkGraduationRequirements(silent = false) {
        const uni = this.state.university;
        const earned = this.getUniversityEarnedCredits();
        const coursesDone = earned >= uni.targetCredits;
        const thesisDone = uni.thesisProgress >= 100;
        if (coursesDone && thesisDone) return true;
        if (!silent) {
            return `尚未满足毕业条件。学分：${earned}/${uni.targetCredits}，论文：${uni.thesisProgress}%`;
        }

        return false;
    },

    tryGraduate() {
        const uni = this.state.university;
        if (!uni.isEnrolled) {
            this.showResult("未入学", "当前没有在读学位。");
            return;
        }

        const ok = this.checkGraduationRequirements(true);
        if (!ok) {
            const msg = this.checkGraduationRequirements(false);
            this.showResult("无法毕业", msg);
            return;
        }

        const degree = uni.programType === 'PhD' ? "博士" : "硕士";
        this.state.player.edu = degree;
        this.state.player.eduStatus = "";
        uni.isEnrolled = false;
        uni.programType = null;
        uni.targetCredits = 0;
        uni.currentQuarters = 0;
        uni.thesisProgress = 0;
        uni.thesisUnlocked = false;
        uni.isDelayed = false;
        uni.activeCourseIds = [];
        uni.courseProgress = {};

        uni.courseCompleted = {};

        uni.selectedThisQuarter = false;
        this.showResult("毕业成功", `获得学位：${degree}。`, { rep: 5, iq: 15, eq: 15 });
        this.updateUI();
    },

    renderExhibitPanel() {
        const c = document.getElementById('exhibits-container');
        c.innerHTML = "";
        const panelLocked = this.state.flags.isPanelLocked;
        c.style.position = panelLocked ? 'relative' : 'static';
        if (this.state.exhibitions.length === 0) {
            c.innerHTML = `<div style="text-align:center; color:#ccc; padding:20px;">暂无进行中的项目</div>`;
            if (panelLocked) {
                const overlay = document.createElement('div');
                overlay.className = 'exhibit-locked-overlay';
                overlay.innerHTML = `<div class="lock-icon">🔒</div><div class="lock-text">行政任务繁忙中...</div><div style="font-size:12px; color:#666; margin-top:5px;">本季度无法推进展览工作</div>`;
                c.appendChild(overlay);
            }
            return;
        }
        this.state.exhibitions.forEach(ex => {
            const div = document.createElement('div');
            div.className = "exhibit-card " + ex.status;
            if (ex.status === 'active') {
                let dlColor = ex.deadline <= 1 ? "var(--danger)" : (ex.deadline <= 2 ? "var(--warning)" : "var(--success)");
                let html = `
                    <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                        <div style="font-weight:bold; color:var(--primary)">${ex.name}</div>
                        <div style="font-weight:bold; color:${dlColor}">🔥 距开展 ${ex.deadline}Q</div>
                    </div>
                    <div class="task-grid">`;
                for(let k in EX_TASKS) {
                    const taskConfig = EX_TASKS[k];
                    const done = ex.tasks[k] >= 100;
                    const unlocked = this.checkPhaseUnlocked(ex, taskConfig.phase);
                    let btnClass = "task-btn";
                    let btnTxt = taskConfig.name;
                    let disabled = "";
                    if (done) {
                        btnClass += " done";
                        btnTxt += " ?";
                        disabled = "disabled";
                    } else if (!unlocked) {
                        btnClass += " locked";
                        btnTxt = "🔒 " + (taskConfig.phase === 2 ? "策划" : "执行");
                        disabled = "disabled";
                    } else if (panelLocked) {
                        btnClass += " locked";
                        disabled = "disabled";
                    }
                    html += `<button class="${btnClass}" style="${!unlocked ? 'opacity:0.5; cursor:not-allowed;' : ''}" 
                             onclick="game.actionExhibitTask(${ex.id},'${k}')" ${disabled}>
                             <span>${btnTxt}</span>
                             </button>`;
                }
                html += `</div>`;
                div.innerHTML = html;
            } else if (ex.status === 'waiting') {
                div.innerHTML = `<div style="font-weight:bold; color:var(--text-main)">${ex.name}</div><div style="color:var(--warning); text-align:center; margin-top:10px;">⏳等待反馈报告...</div>`;
            } else if (ex.status === 'ready_for_feedback') {
                div.innerHTML = `<div style="font-weight:bold; color:var(--text-main)">${ex.name}</div><button class="primary" style="width:100%; margin-top:10px;" onclick="game.actionViewFeedback(${ex.id})">查看报告</button>`;
            }
            c.appendChild(div);
        });
        if (panelLocked) {
            const overlay = document.createElement('div');
            overlay.className = 'exhibit-locked-overlay';
            overlay.innerHTML = `<div class="lock-icon">🔒</div><div class="lock-text">行政任务繁忙中...</div><div style="font-size:12px; color:#666; margin-top:5px;">本季度无法推进展览工作</div>`;
            c.appendChild(overlay);
        }
    },
    actionHomeRest() {
        if (this.state.player.savings < GAME_CONFIG.homeUnlockSavings) {
            this.showResult("未解锁", `需要个人存款达到 ${UTILS.formatMoney(GAME_CONFIG.homeUnlockSavings)} 才能回家。`);
            return;
        }

        if (this.state.flags.hasRestedAtHomeThisQuarter) {
            this.showResult("已经休息过了", "本季度已经在家缓过一口气，下季度再回来躺平吧。");
            return;
        }

        this.markAction();
        this.state.flags.hasRestedAtHomeThisQuarter = true;
        this.showResult("你把手机调成静音，在家里彻底放松了一晚。", GAME_CONFIG.homeRestEffects);
        this.log("success", "🏠 你在家休息了一晚，状态恢复了不少。");
    },
    // [修改] 升级后的摸鱼逻辑：随机抽取剧情事件
    actionLeisure(type) {
        this.markAction();
        if(this.state.limits.leisure <= 0) { 
            this.showResult("没时间了", "本季度的摸鱼额度已用完，快去工作吧！"); 
            return;
        }
        // 随机抽取一个事件
        const eventPool = LEISURE_EVENTS[type];
        if (!eventPool || eventPool.length === 0) return;
        const evt = eventPool[Math.floor(Math.random() * eventPool.length)];
        // 构造选项
        const choices = evt.choices.map(c => ({
            txt: c.txt,
            cb: () => {
                this.state.limits.leisure--; // 只有做出选择后才扣除次数
                this.closeModal();
                this.showResult(c.res, c.effect);
                this.log("system", `🍵 [摸鱼] ${evt.title} - ${c.txt}`);
                this.updateUI();
            }
        }));
        this.showModal(evt.title, evt.desc, choices);
    },

    actionResearch() {
        this.markAction();
        this.changeStat('health', -10);
        this.changeStat('mood', -5);
        this.state.flags.researchApplied = true;
        this.log("system", "📝 已提交课题申报材料，希望能中！");
        this.updateUI();
    },

    settleResearch() {
        let rate = 0.3 + (this.state.player.iq / 200);
        if (Math.random() < rate && this.state.flags.researchSuccessCount < 5) {
            this.state.flags.researchSuccessCount++;
            this.showResult("课题获批立项！", { money: 200000, rep: 10 });
            this.log("success", "🏆 太棒了！申报的课题获批了，经费大幅增加！");
        } else {
            this.log("danger", "遗憾，本年度课题申报未通过。");
        }
    },

actionPromote() {
        this.markAction();
        const p = this.state.player;
        const q = this.state.flags.quartersInTitle;
        let success = false, next = "";

        // 1. 助理 -> 馆员 (入门门槛，保持宽松)
        // 逻辑：工龄到了，且稍有能力或声望即可
        if (p.titleIdx === 0) {
            const conditions = [
                q >= 4,                  // 工龄满1年
                (p.iq + p.eq) >= 80,     // 综合能力尚可
                p.rep >= 10              // 有一点名声
            ];
            // 满足任意2条即可
            if (conditions.filter(Boolean).length >= 2) {
                success = true; next = "馆员";
            }
        }

        // 2. 馆员 -> 副研究馆员 (开始分流)
        else if (p.titleIdx === 1) {
            // 路径A：学术骨干 (高智商，低情商容忍)
            const pathAcademic = p.iq >= 70 && p.rep >= 40;
            // 路径B：八面玲珑 (高情商，中智商)
            const pathManager = p.eq >= 70 && p.iq >= 40 && p.rep >= 40;
            // 基础工龄：2年
            if (q >= 8 && (pathAcademic || pathManager)) {
                success = true; next = "副研究馆员";
            }
        }

        // 3. 副研究馆员 -> 研究馆员 (专家级)
        else if (p.titleIdx === 2) {
            // 路径A：学界泰斗 (智商极高，声望极高)
            const pathExpert = p.iq >= 90 && p.rep >= 100;
            // 路径B：领军人物 (双高，均衡发展)
            const pathLeader = p.iq >= 75 && p.eq >= 75 && p.rep >= 80;
            
            if (q >= 12 && (pathExpert || pathLeader)) {
                success = true; next = "研究馆员";
            }
        }

        // 4. 研究馆员 -> 馆长 (最终BOSS)
        // 馆长必须有极高的声望，且不能有明显的短板
        else if (p.titleIdx === 3) {
            if (q >= 16 && p.rep >= 300 && p.iq >= 80 && p.eq >= 80) {
                success = true; next = "馆长";
            }
        }

        // === 结算逻辑 ===
        this.state.flags.promotedThisYear = true;
        
        if (success) {
            p.titleIdx++;
            this.state.flags.quartersInTitle = 0;
            
            // 如果升到了馆长(index 4)，直接触发结局
            if (p.titleIdx === 4) {
                this.endGame(
                    "结局·馆长",
                    "恭喜你，经过多年的深耕与博弈，你最终成为了这座博物馆的馆长。\n" +
                    "你不仅在学术上有所建树，更懂得如何在复杂的职场中平衡各方利益。\n" +
                    "此刻，你站在办公室的落地窗前，俯瞰着排队入馆的人群。\n" +
                    "这座博物馆的未来，此刻正握在你的手中。"
                );
                return;
            }

            this.showModal("评审通过", `恭喜！凭借出色的表现，你已晋升为 [${next}]！\n工资收入将大幅提升。`, [{txt:"确认",cb:()=>this.closeModal()}]);
        } else {
            // 失败反馈优化：告诉玩家差在哪里
            let reason = "资历或能力尚有欠缺";
            if (p.titleIdx === 3) reason = "馆长之位需要极高的声望(300+)与均衡的能力(双80+)";
            else if (p.titleIdx === 2) reason = "需要更高的学术造诣(IQ>90)或综合管理能力";
            
            this.showResult("评审未通过", `${reason}\n\n(评审委员会认为你还需要再历练一年)\n声望 -5`, { rep: -5 });
        }

        this.updateUI();
    },

    checkSurvival() {
        if (this.state.player.health <= 0) {
            this.endGame(
                "结局·劳碌命",
                "你把几乎所有时间都留给了博物馆。\n展览、会议、报告与突发事件不断叠加，责任从未减轻。\n在长期的透支中，你最终倒在了熟悉的工作岗位上。\n博物馆仍在运转，而你的名字只留在了内部文件与回忆里。\n工作之余也要注意身体\n身体，才是革命的本钱。"
            );
            return true;
        }

        if (this.state.player.mood <= 0) {
            this.endGame(
                "结局·不如回家",
                "繁忙而重复的工作逐渐消磨了你的热情。\n在长期的压力下，你感到情绪低落，开始怀疑继续坚持的意义。\n最终，你选择辞去工作，离开这座熟悉的博物馆。\n或许前路并不清晰，但至少此刻，你决定先回家休息。\n有时候，退出也是一种自我保护。"
            );
            return true;
        }

        return false;
    },

    log(type, msg) {
        const box = document.getElementById('log-container');
        const div = document.createElement('div');
        div.className = `log-entry log-${type}`;
        div.innerText = msg;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    },
    // isNotice: true 表示是通知类弹窗，可点击背景关闭
    showOnboarding() {
        const overlay = document.getElementById('guide-overlay');
        if (overlay) overlay.classList.remove('hidden');
    },

    closeOnboarding() {
        const overlay = document.getElementById('guide-overlay');
        if (overlay) overlay.classList.add('hidden');
    },

showGuide() {
        this.guideSteps = [
            {
                selector: "#status-panel",
                scene: "office",
                text: "👋 欢迎入职！\n展览工作和学业都会消耗【精力值】和【愉悦值】。\n【存款】由工资和项目奖金组成，用于个人消费和交学费。\n注意：【公款/经费】只能用于展览设计，不能混用哦！"
            },
            {
                selector: ".leisure-section",
                scene: "office",
                text: "☕ 摸鱼休息区\n工作累了可以在这里【闭目养神】或【聊八卦】。\n这是恢复精力值和愉悦值的主要途径（虽然偶尔会被抓包）。"
            },
            {
                selector: ".shop-section",
                scene: "office",
                text: "🛒 文创商店\n如果精力实在不够用，可以花点【个人存款】在这里买咖啡或套餐。\n这属于“钞能力”快速回血手段！"
            },
            {
                selector: "#research-block",
                scene: "office",
                text: "🔬 科研项目\n每年【Q1 (第一季度)】开启申报，【Q4】公布结果。\n成功立项能获得大量经费和声望，别错过窗口期！"
            },
            {
                selector: "#exhibit-block",
                scene: "office",
                text: "🏛️ 展览策划\n这是你的核心工作！\n点击【申请新展览】开始项目，随后推进搜集、研究、设计等环节。\n所有工作都会消耗精力，请量力而行。"
            },
            // ========== 【新增】行政任务引导 ==========
            {
                selector: "#panel-admin", // 指向右侧行政面板
                scene: "office",
                text: "🎲 行政甩锅 (高能预警)\n每个季度领导都会派发【行政杂活】。\n你可以点击【掷骰子】尝试甩锅：\n👉 点数≥3：甩锅成功，无事发生。\n👉 点数<3：甩锅失败，【展览面板】将被锁定一季度，无法推进工作！"
            },
            // ========================================
            {
                selector: "#tab-university",
                scene: "office",
                text: "🎓 大学导航\n点击这里可以切换到【大学/进修】界面。\n提升学历是当上馆长的必经之路。"
            },
            {
                selector: "#btn-study-course", 
                scene: "university",
                text: "📚 进修课程\n在这里可以选择短期课程进修，消耗金钱和精力，但能提升智商和声望。"
            },
            {
                selector: "#btn-apply-program", 
                scene: "university",
                text: "📜 学位申请\n只有每年的【Q2】可以申请硕士或博士！\n硕士学制3年，博士4年。记得攒够学费再来申请哦。"
            },
            {
                selector: "#tab-home",
                scene: "office", 
                text: `🏠 家庭系统\n当你的存款达到 ${UTILS.formatMoney(GAME_CONFIG.homeUnlockSavings)} 时就会解锁。\n解锁后每个季度都能回家休息一次，稳定恢复精力和愉悦。`
            },
            {
                selector: "#btn-end-quarter",
                scene: "office",
                text: "🌙 结束季度\n当本季度没有体力或操作次数后，点击这里进入下一季度。\n工资会在此时发放，同时触发随机事件，当前进度也会自动存档。"
            }
        ];
        // 初始化引导状态
        this.guideState = { index: 0 };
        this.renderGuideStep();
        // 绑定窗口大小改变时的重绘，防止遮罩错位
        if (!this._guideResizeHandler) {
            this._guideResizeHandler = () => {
                if (this.guideState) this.renderGuideStep(true);
            };
            window.addEventListener('resize', this._guideResizeHandler);
        }
    },

    renderGuideStep(isResize = false) {
        if (!this.guideSteps || !this.guideState) return;
        const overlay = document.getElementById('guide-overlay');
        const highlight = document.getElementById('guide-highlight');
        const bubble = document.getElementById('guide-bubble');
        const stepEl = document.getElementById('guide-step');
        const textEl = document.getElementById('guide-text');
        const nextBtn = document.getElementById('guide-next');
        if (!overlay || !highlight || !bubble || !stepEl || !textEl || !nextBtn) return;
        const index = this.guideState.index;
        const step = this.guideSteps[index];
        if (!step) return;
        if (!isResize && step.scene) this.switchScene(step.scene);
        overlay.classList.remove('hidden');
        stepEl.innerText = `${index + 1}/${this.guideSteps.length}`;
        textEl.innerText = step.text;
        nextBtn.innerText = index === this.guideSteps.length - 1 ? "我知道了" : "下一步";
        const updatePosition = () => {
            const target = document.querySelector(step.selector);
            if (!target) {
                this.nextGuideStep();
                return;
            }

            const rect = target.getBoundingClientRect();
            const padding = 8;
            const top = Math.max(rect.top - padding, 8);
            const left = Math.max(rect.left - padding, 8);
            const width = Math.min(rect.width + padding * 2, window.innerWidth - left - 8);
            const height = Math.min(rect.height + padding * 2, window.innerHeight - top - 8);
            highlight.style.top = `${top}px`;
            highlight.style.left = `${left}px`;
            highlight.style.width = `${width}px`;
            highlight.style.height = `${height}px`;
            bubble.style.visibility = 'hidden';
            requestAnimationFrame(() => {
                const bubbleRect = bubble.getBoundingClientRect();
                const spaceRight = window.innerWidth - (rect.right + padding);
                const spaceLeft = rect.left - padding;
                const spaceBottom = window.innerHeight - (rect.bottom + padding);
                const spaceTop = rect.top - padding;
                const gap = 12;
                let bubbleTop = rect.top + rect.height / 2 - bubbleRect.height / 2;
                let bubbleLeft = rect.right + gap;
                if (spaceRight >= bubbleRect.width + gap) {
                    bubbleLeft = rect.right + gap;
                } else if (spaceLeft >= bubbleRect.width + gap) {
                    bubbleLeft = rect.left - bubbleRect.width - gap;
                } else if (spaceBottom >= bubbleRect.height + gap) {
                    bubbleTop = rect.bottom + gap;
                    bubbleLeft = rect.left + rect.width / 2 - bubbleRect.width / 2;
                } else {
                    bubbleTop = rect.top - bubbleRect.height - gap;
                    bubbleLeft = rect.left + rect.width / 2 - bubbleRect.width / 2;
                }

                bubbleTop = Math.max(12, Math.min(bubbleTop, window.innerHeight - bubbleRect.height - 12));
                bubbleLeft = Math.max(12, Math.min(bubbleLeft, window.innerWidth - bubbleRect.width - 12));
                bubble.style.top = `${bubbleTop}px`;
                bubble.style.left = `${bubbleLeft}px`;
                bubble.style.visibility = 'visible';
            });
        };

        if (step.scene) {
            setTimeout(updatePosition, 60);
        } else {
            updatePosition();
        }
    },

    nextGuideStep(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        if (!this.guideSteps || !this.guideState) return;
        const nextIndex = this.guideState.index + 1;
        if (nextIndex >= this.guideSteps.length) {
            const overlay = document.getElementById('guide-overlay');
            if (overlay) overlay.classList.add('hidden');
            this.guideState = null;
            return;
        }

        this.guideState.index = nextIndex;
        this.renderGuideStep();
    },

    skipGuide(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const overlay = document.getElementById('guide-overlay');
        if (overlay) overlay.classList.add('hidden');
        this.guideState = null;
    },

    showModal(title, text, choices, isNotice = false) {
        this.isModalOpen = true;
        const modalBox = document.querySelector('.modal-box');
        if (modalBox) {
            modalBox.classList.remove('intro-modal', 'intro-style-bento', 'intro-style-brutal');
        }

        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-text').innerHTML = text.replace(/\n/g, '<br>');
        const cBox = document.getElementById('modal-choices');
        cBox.innerHTML = "";
        choices.forEach(c => {
            const btn = document.createElement('button');
            btn.className = "choice-btn";
            btn.innerText = c.txt;
            btn.onclick = c.cb;
            cBox.appendChild(btn);
        });
        const overlay = document.getElementById('modal-overlay');
        overlay.classList.remove('hidden');
        // 设置是否允许点击背景关闭
        if (isNotice) {
            overlay.setAttribute('onclick', 'game.tryCloseModal(event)');
        } else {
            overlay.removeAttribute('onclick');
        }
    },

    tryCloseModal(e) {
        if (e.target.id === 'modal-overlay') {
            this.closeModal();
        }
    },

    closeModal() { 
        this.isModalOpen = false;
        document.getElementById('modal-overlay').classList.add('hidden'); 
    },

    endGame(t, r) {
        this.clearPersistedProgress();
        this.showModal(t, r, [{txt:"重新开始", cb:()=>location.reload()}]);
    }
};
