(function () {
  "use strict";

  const L = window.StarwishLogic;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const canvas = $("#battleCanvas");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  let state = L.load();
  let selectedItemId = null;
  let activeView = "battle";
  let lastFrame = performance.now();
  let accumulator = 0;
  let uiClock = 0;
  let transitionTimer = 0;
  let audioCtx = null;
  const STEP = .05;
  const GROUND = 394;

  const game = {
    running: false,
    paused: false,
    speed: 1,
    stageId: state.currentStage,
    stage: L.STAGES[state.currentStage - 1],
    phase: "idle",
    waveIndex: 0,
    waveTime: 0,
    stageTime: 0,
    marchDistance: 0,
    world: 0,
    heroes: [],
    enemies: [],
    projectiles: [],
    effects: [],
    feed: [],
    pendingDrops: 0,
    startedAt: 0,
    synergyCd: 0,
    guardComboCd: 0,
    guardWindow: 0,
    report: null
  };

  function freshReport() {
    const zeros = Object.fromEntries(Object.keys(L.CHARACTERS).map(id => [id, 0]));
    return { stage: game.stageId, damageByHero: { ...zeros }, takenByHero: { ...zeros }, skillsByHero: { ...zeros }, synergyBursts: 0, guardCombos: 0, breakSeconds: 0, starSeconds: 0, bossHeal: 0, frontDownAt: null, loot: [] };
  }

  function buildReport(success, reason) {
    const report = game.report || freshReport();
    report.success = success;
    report.reason = reason || "";
    report.seconds = Math.round(game.stageTime * 10) / 10;
    report.totalDamage = Math.round(Object.values(report.damageByHero).reduce((a, b) => a + b, 0));
    report.totalTaken = Math.round(Object.values(report.takenByHero).reduce((a, b) => a + b, 0));
    report.breakUptime = Math.min(100, Math.round(report.breakSeconds / Math.max(1, game.stageTime) * 100));
    report.starUptime = Math.min(100, Math.round(report.starSeconds / Math.max(1, game.stageTime) * 100));
    return report;
  }

  function beep(type) {
    if (!state.settings.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const map = { hit: 260, skill: 520, drop: 740, win: 620, hurt: 150 };
      osc.frequency.value = map[type] || 340;
      osc.type = type === "hurt" ? "sawtooth" : "square";
      gain.gain.setValueAtTime(.025, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + .08);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + .08);
    } catch (_) { /* Audio is decorative. */ }
  }

  function addFeed(text, tone) {
    game.feed.unshift({ text, tone: tone || "", at: performance.now() });
    game.feed = game.feed.slice(0, 3);
    $("#battleFeed").innerHTML = game.feed.map(x => `<div class="feed-line ${x.tone}">${x.text}</div>`).join("");
  }

  function toast(text, tone) {
    const el = document.createElement("div");
    el.className = `toast ${tone || ""}`;
    el.textContent = text;
    $("#toastStack").appendChild(el);
    setTimeout(() => el.remove(), 3700);
  }

  function showLoot(text, color) {
    const el = document.createElement("div");
    el.className = "loot-pop";
    el.textContent = text;
    el.style.color = color || "white";
    $("#lootFloat").appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  function showModal(html, dismissible) {
    $("#modalContent").innerHTML = html;
    $("#modalBackdrop").hidden = false;
    $("#modalClose").hidden = dismissible === false;
  }

  function closeModal() { $("#modalBackdrop").hidden = true; }

  function createHeroes(resetHealth) {
    const spacing = 62;
    return state.formation.map((id, index) => {
      const stats = L.characterStats(state, id);
      const old = !resetHealth && game.heroes.find(h => h.id === id);
      return {
        id, def: L.CHARACTERS[id], stats,
        x: 195 + index * spacing,
        homeX: 195 + index * spacing,
        hp: old ? Math.min(stats.maxHp, old.hp) : stats.maxHp,
        atkCd: .3 + index * .16,
        skillCd: 2.5 + index * .45,
        action: "idle", actionT: 0,
        down: false, guardCd: 0, empowered: false,
        attackCount: 0, inspireCd: 0, counterCd: 0,
        damageDone: 0, damageTaken: 0
      };
    });
  }

  function startStage(stageId, silent) {
    clearTimeout(transitionTimer);
    stageId = L.clamp(stageId, 1, state.unlockedStage);
    state.currentStage = stageId;
    game.stageId = stageId;
    game.stage = L.STAGES[stageId - 1];
    game.phase = "march";
    game.waveIndex = 0;
    game.waveTime = 0;
    game.stageTime = 0;
    game.marchDistance = 0;
    game.world = 0;
    game.heroes = createHeroes(true);
    game.enemies = [];
    game.projectiles = [];
    game.effects = [];
    game.pendingDrops = 0;
    game.synergyCd = 0;
    game.guardComboCd = 0;
    game.guardWindow = 0;
    game.report = freshReport();
    game.running = true;
    game.paused = false;
    game.startedAt = performance.now();
    updateStageUI();
    if (!silent) addFeed(`进入第${stageId}关 · ${game.stage.name}`);
    L.save(state);
  }

  function spawnWave() {
    const codes = game.stage.waves[game.waveIndex];
    game.enemies = codes.map((code, i) => {
      const def = L.ENEMIES[code];
      const hp = Math.round(def.hp * L.hpMultiplier(game.stageId) * (def.boss ? .68 : 1));
      return {
        uid: `${code}-${game.waveIndex}-${i}-${Date.now()}`,
        code, def, x: 830 + i * 62,
        hp, maxHp: hp,
        atk: Math.round(def.atk * L.atkMultiplier(game.stageId) * (def.boss ? .72 : 1)),
        defense: def.def,
        atkCd: 1 + i * .28,
        specialCd: def.id === "mushroom" ? 6 : def.boss ? 7 : 99,
        shield: 0, breakT: 0, starT: 0,
        action: "enter", actionT: .4,
        dead: false, rewarded: false,
        recentHitters: {},
        eliteShielded: false, bossHealed: false, bossShielded: false,
        summoned: false
      };
    });
    game.phase = "combat";
    game.waveTime = 0;
    addFeed(`遭遇 ${codes.map(c => L.ENEMIES[c].name).join("、")}`, codes.includes("B") ? "boss" : "");
    if (codes.includes("B")) beep("skill");
    updateStageUI();
  }

  function chooseTarget(hero) {
    const alive = game.enemies.filter(e => !e.dead);
    if (!alive.length) return null;
    if (state.tactic === "assault" && (hero.id === "archer" || hero.id === "mage")) {
      return alive.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.x - b.x)[0];
    }
    return alive.sort((a, b) => a.x - b.x)[0];
  }

  function frontHero() {
    return game.heroes.filter(h => !h.down).sort((a, b) => b.x - a.x)[0] || null;
  }

  function addEffect(type, x, y, text, color, duration) {
    game.effects.push({ type, x, y, text, color: color || "#fff", t: duration || .7, life: duration || .7 });
    if (game.effects.length > 70) game.effects.splice(0, game.effects.length - 70);
  }

  function applyEnemyDamage(hero, enemy, multiplier, opts) {
    if (!enemy || enemy.dead) return 0;
    opts = opts || {};
    enemy.recentHitters = enemy.recentHitters || {};
    let bonus = opts.bonus || 0;
    if (enemy.breakT > 0) bonus += (hero.stats.armorBreakDmg || 0) + (hero.id === "lancer" ? .1 : 0);
    if (enemy.starT > 0) bonus += .08 + (hero.stats.starDmg || 0);
    const crit = !opts.noCrit && L.rngNext(state) < hero.stats.crit;
    const effectiveDef = enemy.defense * (enemy.breakT > 0 ? .8 : 1);
    let amount = L.damage(hero.stats.atk, multiplier, effectiveDef, bonus, crit, hero.stats.critDmg);
    if (enemy.shield > 0) {
      const absorbed = Math.min(enemy.shield, amount);
      enemy.shield -= absorbed;
      amount -= absorbed;
      addEffect("text", enemy.x, GROUND - 96, `盾 ${absorbed}`, "#78c9ff", .7);
    }
    if (amount > 0) {
      enemy.hp = Math.max(0, enemy.hp - amount);
      hero.damageDone += amount;
      if (game.report) game.report.damageByHero[hero.id] += amount;
      enemy.recentHitters[hero.id] = game.stageTime;
      addEffect("text", enemy.x, GROUND - 72, `${crit ? "✦ " : ""}${amount}`, crit ? "#ffe06a" : "#fff", .72);
      addEffect("spark", enemy.x - 6, GROUND - 56, "", opts.magic ? "#b69cff" : "#ecf7ff", .35);
    }
    const recentTeam = Object.values(enemy.recentHitters || {}).filter(at => game.stageTime - at <= 5).length;
    if (!opts.noCombo && enemy.hp > 0 && enemy.breakT > 0 && enemy.starT > 0 && recentTeam >= 2 && game.synergyCd <= 0) {
      game.synergyCd = 12;
      game.report.synergyBursts++;
      addFeed("协同爆发 · 破甲与星痕共鸣！", "gold");
      addEffect("synergy", enemy.x, GROUND - 58, "协同爆发", "#fff09a", 1.1);
      game.heroes.filter(h => !h.down).forEach(h => applyEnemyDamage(h, enemy, .28, { noCrit: true, magic: true, noCombo: true }));
    }
    if (enemy.hp <= 0) killEnemy(enemy, hero);
    return amount;
  }

  function shoot(hero, enemy, multiplier, type, count) {
    for (let i = 0; i < (count || 1); i++) {
      game.projectiles.push({
        owner: hero, target: enemy, x: hero.x + 18, y: GROUND - 58 - i * 3,
        speed: type === "arrow" ? 360 : 285,
        multiplier, type, alive: true, delay: i * .1
      });
    }
  }

  function normalAttack(hero, target) {
    hero.action = "attack"; hero.actionT = .42;
    hero.atkCd = hero.stats.interval;
    hero.attackCount++;
    if (hero.id === "archer") {
      shoot(hero, target, 1, "arrow");
      if (hero.stats.legendaryId === "star-bow" && hero.attackCount % 4 === 0) {
        shoot(hero, target, .5, "star-arrow", 2);
        addFeed("星羽长弓 · 追加双箭", "gold");
      }
    } else if (hero.id === "mage") {
      shoot(hero, target, 1, "magic");
    } else {
      applyEnemyDamage(hero, target, hero.empowered ? 1.15 : 1);
      if (hero.id === "lancer" && game.guardWindow > 0 && game.guardComboCd <= 0 && !target.dead) {
        game.guardComboCd = 10;
        game.guardWindow = 0;
        game.report.guardCombos++;
        game.heroes.forEach(h => { h.inspiredT = Math.max(h.inspiredT || 0, 3); });
        applyEnemyDamage(hero, target, .75, { noCrit: true, noCombo: true });
        addEffect("guardlink", (hero.x + target.x) / 2, GROUND - 52, "守望突击", "#9eeeff", .9);
        addFeed("守望突击 · 守护后接枪击，全队提速", "skill");
      }
      if (hero.id === "knight" && hero.empowered && hero.stats.legendaryId === "star-sword") {
        game.enemies.filter(e => !e.dead && Math.abs(e.x - target.x) < 95).slice(0, 2).forEach(e => applyEnemyDamage(hero, e, .8, { noCrit: true }));
        addEffect("slash", target.x, GROUND - 52, "", "#8ed8ff", .55);
      }
      hero.empowered = false;
      if (hero.id === "lancer" && target.breakT > 0 && hero.stats.legendaryId === "wind-spear" && L.rngNext(state) < .25) {
        applyEnemyDamage(hero, target, .6, { noCrit: true });
        addFeed("风行之枪 · 追击", "gold");
      }
    }
    beep("hit");
  }

  function castSkill(hero, target) {
    const level = state.skills[hero.id] || 1;
    hero.action = "skill"; hero.actionT = .72;
    hero.skillCd = hero.stats.skillCd;
    if (game.report) game.report.skillsByHero[hero.id]++;
    const multiplier = hero.def.skillBase + .15 * (level - 1);
    if (hero.id === "knight") {
      game.enemies.filter(e => !e.dead && e.x - hero.x <= 105).slice(0, 2).forEach(e => applyEnemyDamage(hero, e, multiplier));
      addEffect("slash", hero.x + 70, GROUND - 58, "星花斩", "#9edcff", .75);
    } else if (hero.id === "lancer") {
      applyEnemyDamage(hero, target, multiplier);
      target.breakT = 5;
      addEffect("text", target.x, GROUND - 112, "破甲", "#ffad67", .9);
      addEffect("thrust", target.x - 35, GROUND - 45, "", "#ff9bae", .55);
    } else if (hero.id === "archer") {
      shoot(hero, target, multiplier / 3, "skill-arrow", 3);
      addEffect("text", hero.x + 40, GROUND - 105, "星羽连射", "#c7ffcf", .8);
    } else {
      const targets = game.enemies.filter(e => !e.dead).sort((a, b) => Math.abs(a.x - target.x) - Math.abs(b.x - target.x)).slice(0, 3);
      targets.forEach(e => { applyEnemyDamage(hero, e, multiplier, { magic: true }); e.starT = 5; });
      addEffect("starstorm", target.x, GROUND - 90, "星屑风暴", "#cbb7ff", 1);
      if (hero.stats.legendaryId === "moon-book") targets.forEach(e => applyEnemyDamage(hero, e, .6, { magic: true, noCrit: true }));
    }
    if (hero.stats.inspire && hero.inspireCd <= 0 && L.rngNext(state) < .1) {
      game.heroes.forEach(h => { h.inspiredT = 4; });
      hero.inspireCd = 12;
      addFeed(`${hero.def.name}的鼓舞使全队攻速提升`, "gold");
    }
    addFeed(`${hero.def.name} · ${hero.def.skill}`, "skill");
    beep("skill");
  }

  function hurtHero(hero, raw, attacker, special) {
    if (!hero || hero.down) return;
    let amount = L.damage(raw, special ? 1.5 : 1, hero.stats.def, 0, false, 1.5);
    if (hero.id === "knight" && hero.guardCd <= 0) {
      amount = Math.max(1, Math.floor(amount * .75));
      hero.guardCd = 8;
      hero.empowered = true;
      game.guardWindow = 4;
      addEffect("text", hero.x, GROUND - 106, "守护", "#8cd8ff", .8);
    }
    hero.hp = Math.max(0, hero.hp - amount);
    hero.damageTaken += amount;
    if (game.report) game.report.takenByHero[hero.id] += amount;
    hero.action = "hurt"; hero.actionT = .25;
    addEffect("text", hero.x, GROUND - 75, `-${amount}`, "#ffb2b8", .65);
    if (hero.stats.counter && hero.counterCd <= 0 && L.rngNext(state) < .15 && attacker && !attacker.dead) {
      applyEnemyDamage(hero, attacker, .5, { noCrit: true });
      hero.counterCd = 3;
      addEffect("text", attacker.x, GROUND - 108, "反击", "#ffdb8b", .7);
    }
    if (hero.hp <= 0) {
      hero.down = true; hero.action = "down"; hero.actionT = 999;
      if (hero.id === "knight" && game.report && game.report.frontDownAt === null) game.report.frontDownAt = Math.round(game.stageTime * 10) / 10;
      addFeed(`${hero.def.name}倒下了`, "danger");
    }
    beep("hurt");
  }

  function killEnemy(enemy) {
    if (enemy.dead) return;
    enemy.dead = true; enemy.action = "dead"; enemy.actionT = .8;
    const reward = L.rewardForEnemy(game.stageId, enemy.def);
    state.gold += reward.gold;
    const levels = L.addExperience(state, reward.xp);
    state.totalKills++;
    if (levels) { toast(`冒险等级提升至 Lv.${state.level}！`, "gold"); game.heroes.forEach(h => { const s = L.characterStats(state, h.id); h.hp += s.maxHp - h.stats.maxHp; h.stats = s; }); }
    const guaranteed = enemy.def.elite || enemy.def.boss;
    if (guaranteed || L.rngNext(state) < .18) {
      let options = guaranteed ? { minQuality: "rare" } : {};
      if (state.idlePlan === "gear" && state.lootFocus !== "all" && L.rngNext(state) < .7) options.slot = state.lootFocus;
      if (game.stageId === 1 && !state.firstClears[1] && game.pendingDrops === 0) options = { minQuality: "magic", slot: "armor" };
      const item = L.generateItem(state, game.stageId, options);
      const result = L.addItem(state, item);
      game.pendingDrops++;
      const quality = L.qualityById(item.quality);
      if (result.kept) {
        if (game.report) game.report.loot.push({ name: item.name, quality: item.quality });
        showLoot(`${quality.name} · ${item.name}`, quality.color);
        toast(`获得${quality.name}装备：${item.name}`, item.quality === "legendary" ? "gold" : "");
        beep("drop");
      } else showLoot(`自动分解 +${result.gold}金币`, "#ffe277");
    }
    addEffect("burst", enemy.x, GROUND - 45, "", "#d6ffc3", .8);
  }

  function updateHero(hero, dt) {
    if (hero.down) return;
    hero.actionT = Math.max(0, hero.actionT - dt);
    if (hero.actionT <= 0) hero.action = game.phase === "march" ? "run" : "idle";
    hero.atkCd -= dt * (hero.inspiredT > 0 ? 1.05 : 1);
    hero.skillCd -= dt;
    hero.guardCd -= dt; hero.inspireCd -= dt; hero.counterCd -= dt; hero.inspiredT = Math.max(0, (hero.inspiredT || 0) - dt);
    if (hero.stats.regen) hero.hp = Math.min(hero.stats.maxHp, hero.hp + hero.stats.maxHp * hero.stats.regen * dt);
    if (game.phase === "march") {
      hero.x += (hero.homeX - hero.x) * Math.min(1, dt * 7);
      return;
    }
    const target = chooseTarget(hero);
    if (!target) return;
    const range = hero.def.range + (state.tactic === "guard" && (hero.id === "archer" || hero.id === "mage") ? 25 : 0);
    const distance = target.x - hero.x;
    if (distance > range) {
      if (hero.id === "knight" || hero.id === "lancer") {
        hero.x += Math.min(46 * dt, distance - range);
        hero.action = "run";
      }
      return;
    }
    if (hero.skillCd <= 0) castSkill(hero, target);
    else if (hero.atkCd <= 0) normalAttack(hero, target);
  }

  function updateEnemy(enemy, dt) {
    if (enemy.dead) { enemy.actionT -= dt; return; }
    enemy.actionT -= dt;
    enemy.atkCd -= dt; enemy.specialCd -= dt; enemy.breakT -= dt; enemy.starT -= dt;
    if (enemy.def.id === "mushroom" && enemy.specialCd <= 0) {
      enemy.shield += enemy.maxHp * .15; enemy.specialCd = 12;
      addEffect("text", enemy.x, GROUND - 100, "叶盾", "#8be3a8", .8);
    }
    if (enemy.def.elite && !enemy.eliteShielded && enemy.hp / enemy.maxHp < .5) {
      enemy.shield += enemy.maxHp * .2; enemy.eliteShielded = true;
      addFeed("史莱姆王发动花蜜护体", "boss");
    }
    if (enemy.def.boss) {
      if (!enemy.bossHealed && enemy.hp / enemy.maxHp < .6) {
        const beforeHeal = enemy.hp;
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.maxHp * .08); enemy.bossHealed = true;
        if (game.report) game.report.bossHeal += Math.round(enemy.hp - beforeHeal);
        const summons = [0, 1].map((_, i) => {
          const d = L.ENEMIES.S; const hp = Math.round(d.hp * L.hpMultiplier(game.stageId));
          return { uid: `summon-${i}-${Date.now()}`, code: "S", def: d, x: enemy.x + 65 + i * 48, hp, maxHp: hp, atk: Math.round(d.atk * L.atkMultiplier(game.stageId)), defense: d.def, atkCd: 1, specialCd: 99, shield: 0, breakT: 0, starT: 0, action: "enter", actionT: .4, dead: false, rewarded: false };
        });
        game.enemies.push(...summons);
        addFeed("花冠鹿灵发动自然祝福，召唤花灵！", "boss");
        addEffect("starstorm", enemy.x, GROUND - 90, "自然祝福", "#a7ffbe", 1.2);
      }
      if (!enemy.bossShielded && enemy.hp / enemy.maxHp < .3) {
        enemy.shield += enemy.maxHp * .15; enemy.bossShielded = true;
        addFeed("花冠鹿灵展开花冠守护", "boss");
      }
      if (enemy.windup > 0) {
        enemy.windup -= dt;
        if (enemy.windup <= 0 && enemy.windupTarget && !enemy.windupTarget.down) {
          hurtHero(enemy.windupTarget, enemy.atk, enemy, true);
          enemy.windupTarget = null;
        }
      } else if (enemy.specialCd <= 0) {
        const target = frontHero();
        if (target) {
          enemy.windup = 1.2;
          enemy.windupTarget = target;
          addEffect("vine", target.x, GROUND - 24, "花藤打击", "#8ae08e", 1.2);
          addFeed("花冠鹿灵正在蓄力花藤打击", "boss");
        }
        enemy.specialCd = 9;
      }
    }
    const target = frontHero();
    if (!target) return;
    const distance = enemy.x - target.x;
    if (distance > enemy.def.range) {
      enemy.x -= enemy.def.speed * dt;
      enemy.action = "move";
    } else if (enemy.atkCd <= 0) {
      enemy.action = "attack"; enemy.actionT = .45; enemy.atkCd = enemy.def.interval;
      if (enemy.def.id === "dandelion") {
        game.projectiles.push({ enemyOwner: enemy, targetHero: target, x: enemy.x - 12, y: GROUND - 60, speed: 210, type: "enemy-magic", alive: true, delay: 0 });
      } else hurtHero(target, enemy.atk, enemy, false);
    }
  }

  function updateProjectiles(dt) {
    game.projectiles.forEach(p => {
      if (!p.alive) return;
      if (p.delay > 0) { p.delay -= dt; return; }
      if (p.target) {
        if (p.target.dead) { p.alive = false; return; }
        const dx = p.target.x - p.x;
        p.x += Math.sign(dx) * p.speed * dt;
        p.y += ((GROUND - 58) - p.y) * dt * 4;
        if (Math.abs(dx) < 18) { applyEnemyDamage(p.owner, p.target, p.multiplier, { magic: p.type === "magic" }); p.alive = false; }
      } else if (p.targetHero) {
        if (p.targetHero.down) { p.alive = false; return; }
        const dx = p.targetHero.x - p.x;
        p.x += Math.sign(dx) * p.speed * dt;
        if (Math.abs(dx) < 16) { hurtHero(p.targetHero, p.enemyOwner.atk, p.enemyOwner, false); p.alive = false; }
      }
    });
    game.projectiles = game.projectiles.filter(p => p.alive);
  }

  function updateEffects(dt) {
    game.effects.forEach(e => e.t -= dt);
    game.effects = game.effects.filter(e => e.t > 0);
  }

  function finishWave() {
    game.heroes.filter(h => !h.down).forEach(h => { h.hp = Math.min(h.stats.maxHp, h.hp + h.stats.maxHp * .15); h.x = h.homeX; });
    if (game.waveIndex >= game.stage.waves.length - 1) completeStage();
    else {
      game.waveIndex++;
      game.phase = "march";
      game.marchDistance = 0;
      game.enemies = [];
      game.projectiles = [];
      addFeed("敌人已清除，小队继续前进");
      updateStageUI();
    }
  }

  function completeStage() {
    if (!game.running) return;
    game.running = false; game.phase = "victory";
    const first = !state.firstClears[game.stageId];
    if (game.stageId === 1 && first && game.pendingDrops === 0) {
      const guaranteedItem = L.generateItem(state, 1, { minQuality: "magic", slot: "armor" });
      L.addItem(state, guaranteedItem);
      game.pendingDrops++;
      const quality = L.qualityById(guaranteedItem.quality);
      showLoot(`${quality.name} · ${guaranteedItem.name}`, quality.color);
      toast(`首通保底：${guaranteedItem.name}`, "gold");
    }
    if (first && (game.stageId === 3 || game.stageId === 7)) {
      const milestone = L.generateItem(state, game.stageId, game.stageId === 3
        ? { minQuality: "rare", slot: "weapon" }
        : { minQuality: "epic", slot: "accessory", forceAffixes: ["synergy", "starlight"] });
      const kept = L.addItem(state, milestone);
      if (kept.kept) {
        game.report.loot.push({ name: milestone.name, quality: milestone.quality });
        game.pendingDrops++;
        showLoot(`里程碑保底 · ${milestone.name}`, L.qualityById(milestone.quality).color);
        toast(`第${game.stageId}关保底：${milestone.name}`, "gold");
      }
    }
    state.firstClears[game.stageId] = true;
    const bonus = game.stageId * 20;
    state.gold += bonus;
    const report = buildReport(true);
    L.recordRun(state, game.stageId, true, game.stageTime, report);
    state.failures = 0;
    if (game.stageId < 10) state.unlockedStage = Math.max(state.unlockedStage, game.stageId + 1);
    if (game.stageId === 10 && !first) {
      state.shards += 1;
      state.bossRecords.drops = [...(state.bossRecords.drops || []), `花冠碎片 ×1`].slice(-20);
      if (L.rngNext(state) < .01) {
        const legend = L.generateItem(state, 10, { legendaryId: Object.values(L.LEGENDARIES)[Math.floor(L.rngNext(state) * 4)].id });
        L.addItem(state, legend);
        toast(`幸运掉落：${legend.name}！`, "gold");
      }
    }
    game.heroes.filter(h => !h.down).forEach(h => { h.action = "victory"; h.actionT = 3; });
    addFeed(`通关！用时 ${game.stageTime.toFixed(1)} 秒`, "gold");
    toast(`第${game.stageId}关通关 · +${bonus}金币`, "gold");
    beep("win");
    L.save(state);
    renderTopUI();
    $("#reportButton").hidden = false;
    if (game.stageId === 10 && first) {
      setTimeout(showLegendChoice, 900);
      return;
    }
    const next = state.idlePlan === "progress" && game.stageId < 10 ? game.stageId + 1 : state.idlePlan === "boss" && state.unlockedStage >= 10 ? 10 : L.clamp(state.planStage || game.stageId, 1, state.unlockedStage);
    transitionTimer = setTimeout(() => startStage(next), 2600 / game.speed);
  }

  function failStage(reason) {
    if (!game.running) return;
    game.running = false; game.phase = "defeat";
    const provisional = buildReport(false, reason);
    let diagnosis = reason;
    if (provisional.frontDownAt !== null && provisional.frontDownAt < game.stageTime * .55) diagnosis = `前排在 ${provisional.frontDownAt}s 过早倒下；优先提升骑士生命、防御或切换守势。`;
    else if (game.stageId === 10 && provisional.breakUptime < 25) diagnosis = `BOSS破甲覆盖仅 ${provisional.breakUptime}%；强化枪兵冷却并保留协同词条。`;
    else if (provisional.bossHeal > 0) diagnosis = `BOSS本次回复 ${provisional.bossHeal} 生命；第二阶段输出不足，建议使用BOSS预设。`;
    provisional.reason = diagnosis;
    L.recordRun(state, game.stageId, false, game.stageTime, provisional);
    state.failures++;
    addFeed(`挑战失败：${diagnosis}`, "danger");
    toast(diagnosis, "error");
    $("#reportButton").hidden = false;
    let retryStage = game.stageId;
    if (state.mode === "progress" && state.failures >= 3) {
      retryStage = Math.min(state.lastStableStage || Math.max(1, game.stageId - 1), state.unlockedStage);
      state.mode = "repeat"; state.idlePlan = "gear"; state.planStage = retryStage;
      state.failures = 0;
      toast(`连续失败，已回到第${retryStage}关稳定挂机。`);
    }
    L.save(state);
    renderTopUI();
    transitionTimer = setTimeout(() => startStage(retryStage), 3200 / game.speed);
  }

  function update(dt) {
    if (!game.running || game.paused) return;
    game.stageTime += dt;
    game.synergyCd -= dt; game.guardComboCd -= dt; game.guardWindow -= dt;
    updateEffects(dt);
    if (game.phase === "march") {
      game.world += 56 * dt;
      game.marchDistance += 56 * dt;
      game.heroes.forEach(h => updateHero(h, dt));
      const patrol = state.settings.quickPatrol && state.idlePlan !== "progress" ? 118 : 250;
      if (game.marchDistance >= patrol + game.waveIndex * 22) spawnWave();
      return;
    }
    if (game.phase !== "combat") return;
    game.waveTime += dt;
    game.heroes.forEach(h => updateHero(h, dt));
    game.enemies.forEach(e => updateEnemy(e, dt));
    if (game.report) {
      const boss = game.enemies.find(e => e.def.boss && !e.dead);
      if (boss?.breakT > 0) game.report.breakSeconds += dt;
      if (boss?.starT > 0) game.report.starSeconds += dt;
    }
    updateProjectiles(dt);
    if (game.heroes.every(h => h.down)) return failStage("冒险团全员倒下，建议强化前线生存能力。 ");
    const limit = game.enemies.some(e => e.def.boss && !e.dead) ? 75 : 90;
    if (game.waveTime >= limit) return failStage("战斗超时，建议优化输出装备或升级技能。 ");
    if (game.enemies.length && game.enemies.every(e => e.dead) && game.projectiles.length === 0) finishWave();
  }

  function drawPixel(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), w, h); }

  function drawBackground(time) {
    const w = canvas.width, h = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#7fd3ee"); grad.addColorStop(.57, "#dff6dc"); grad.addColorStop(1, "#9acd70");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    const sun = ctx.createRadialGradient(128, 76, 8, 128, 76, 105);
    sun.addColorStop(0, "rgba(255,250,190,.95)"); sun.addColorStop(.3, "rgba(255,239,155,.34)"); sun.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sun; ctx.fillRect(0, 0, 260, 210);
    const cloudOffset = -(game.world * .08) % 260;
    for (let i = -1; i < 6; i++) {
      const x = cloudOffset + i * 240 + (i % 2) * 45;
      drawPixel(x, 74 + (i % 3) * 24, 70, 18, "rgba(255,255,255,.72)");
      drawPixel(x + 18, 60 + (i % 3) * 24, 42, 18, "rgba(255,255,255,.72)");
      drawPixel(x + 56, 80 + (i % 3) * 24, 38, 12, "rgba(255,255,255,.72)");
    }
    const far = -(game.world * .15) % 320;
    ctx.fillStyle = "#9fd3ad";
    for (let i = -2; i < 6; i++) {
      ctx.beginPath(); ctx.moveTo(far + i * 240, 320); ctx.lineTo(far + i * 240 + 130, 160 + (i % 2) * 20); ctx.lineTo(far + i * 240 + 280, 320); ctx.fill();
    }
    const ruin = 610 - (game.world * .12 % 1250);
    drawPixel(ruin, 230, 18, 104, "#9eb7a2"); drawPixel(ruin + 70, 246, 17, 88, "#91ad98");
    drawPixel(ruin - 8, 220, 105, 13, "#bfd0b1"); drawPixel(ruin + 24, 246, 37, 88, "rgba(210,230,195,.62)");
    const hills = -(game.world * .28) % 190;
    ctx.fillStyle = "#70bd80";
    for (let i = -2; i < 8; i++) {
      ctx.beginPath(); ctx.arc(hills + i * 170, 326, 120, Math.PI, 0); ctx.fill();
    }
    const trees = -(game.world * .48) % 180;
    for (let i = -1; i < 8; i++) {
      const x = trees + i * 170 + (i % 2) * 33;
      drawPixel(x, 260, 16, 74, "#6f8c55");
      drawPixel(x - 26, 226, 68, 54, i % 3 ? "#5fa967" : "#73b86b");
      drawPixel(x - 12, 208, 42, 36, "#82c67b");
    }
    const mill = 850 - (game.world * .35 % 1350);
    drawPixel(mill, 254, 44, 80, "#eadbb6"); drawPixel(mill - 8, 244, 60, 13, "#a77d62"); drawPixel(mill + 18, 276, 10, 58, "#8b654c");
    ctx.save(); ctx.translate(mill + 22, 250); ctx.rotate(time * .18); for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); drawPixel(0, -3, 52, 7, "#f1e7cd"); drawPixel(34, -7, 18, 14, "rgba(247,239,215,.8)"); } ctx.restore();
    drawPixel(0, 334, w, 60, "#72bf63");
    drawPixel(0, 354, w, 40, "#8dd16f");
    drawPixel(0, GROUND, w, h - GROUND, "#c39a61");
    drawPixel(0, GROUND + 18, w, h - GROUND - 18, "#d6b374");
    const near = -(game.world * .8) % 72;
    for (let i = -1; i < 16; i++) {
      const x = near + i * 72;
      drawPixel(x, GROUND - 10, 5, 10, i % 3 === 0 ? "#ffdf70" : "#f58da8");
      drawPixel(x + 5, GROUND - 7, 8, 3, "#479e56");
      drawPixel(x + 34, GROUND + 32, 22, 4, "rgba(126,83,49,.2)");
    }
    for (let i = 0; i < 9; i++) {
      const px = (i * 137 - game.world * (.55 + i * .02)) % 1100;
      const py = 150 + (i % 4) * 45 + Math.sin(time * 1.5 + i) * 12;
      drawPixel(px < -10 ? px + 1100 : px, py, 5, 4, i % 2 ? "rgba(255,238,143,.8)" : "rgba(255,178,199,.75)");
    }
    if (game.stageId >= 8) {
      drawPixel(760 - (game.world * .25 % 900), 210, 66, 124, "#e5dfc1");
      drawPixel(748 - (game.world * .25 % 900), 190, 90, 24, "#b7a88c");
    }
  }

  function drawHero(hero, time) {
    const bob = hero.action === "run" ? Math.round(Math.sin(time * 13 + hero.homeX) * 3) : Math.round(Math.sin(time * 3.2 + hero.homeX) * 1.5);
    const strike = hero.action === "attack" || hero.action === "skill";
    const leg = hero.action === "run" ? Math.round(Math.sin(time * 13 + hero.homeX) * 5) : 0;
    const recoil = hero.action === "hurt" ? -4 : 0;
    ctx.save(); ctx.translate(Math.round(hero.x) + recoil, GROUND + bob); ctx.scale(1.06, 1.06);
    if (hero.down) { ctx.rotate(Math.PI / 2.55); ctx.translate(0, 13); }
    ctx.globalAlpha = hero.down ? .55 : 1;
    drawPixel(-24, -3, 50, 7, "rgba(42,59,65,.24)");
    const outline = "#2e3b55", skin = "#ffd4ba", light = "#fff1df";
    const legs = (boot, sock) => { drawPixel(-11 - leg, -21, 9, 21, outline); drawPixel(4 + leg, -21, 9, 21, outline); drawPixel(-9 - leg, -19, 6, 13, sock); drawPixel(6 + leg, -19, 6, 13, sock); drawPixel(-11 - leg, -6, 10, 6, boot); drawPixel(4 + leg, -6, 11, 6, boot); };
    if (hero.id === "mage") {
      legs("#51428d", "#ece7ff");
      drawPixel(-17, -50, 34, 30, outline); drawPixel(-14, -48, 28, 26, "#7563c7"); drawPixel(-12, -46, 7, 21, "#a995ec");
      drawPixel(-16, -66, 31, 22, skin); drawPixel(-18, -73, 35, 16, "#a995e5"); drawPixel(-19, -65, 9, 24, "#8a72d1"); drawPixel(10, -64, 8, 26, "#765fb9");
      drawPixel(-13, -63, 8, 5, light); drawPixel(8, -60, 4, 4, "#3c4770");
      drawPixel(-17, -82, 38, 9, outline); drawPixel(-12, -91, 28, 12, outline); drawPixel(-9, -89, 23, 9, "#6c5bbb"); drawPixel(13, -96, 8, 16, "#9c83e0");
      const float = strike ? 8 : 0; drawPixel(19 + float, -49, 25, 20, outline); drawPixel(22 + float, -46, 8, 14, "#e8ddff"); drawPixel(33 + float, -46, 8, 14, "#b7d7ff");
      if (hero.action === "skill") for (let i = 0; i < 4; i++) drawPixel(19 + i * 10, -83 - (i % 2) * 8, 6, 6, i % 2 ? "#9ee8ff" : "#f4ddff");
    } else if (hero.id === "archer") {
      legs("#4d6d4e", "#dff6d9");
      drawPixel(-20, -51, 34, 31, outline); drawPixel(-17, -48, 28, 27, "#3f9f63"); drawPixel(-17, -48, 8, 26, "#71ca89"); drawPixel(-22, -43, 9, 24, "#2f704a");
      drawPixel(-17, -67, 31, 23, skin); drawPixel(-20, -73, 35, 17, "#66bf81"); drawPixel(-21, -66, 9, 24, "#4da66c");
      drawPixel(-15, -64, 8, 5, light); drawPixel(7, -61, 4, 4, "#385268");
      drawPixel(-17, -80, 27, 9, "#397f52"); drawPixel(-9, -85, 24, 9, "#75cc8e");
      drawPixel(-25, -67, 9, 8, "#85dc99"); drawPixel(-32, -63, 14, 7, "#5eaf74");
      ctx.strokeStyle = "#82572f"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(28 + (strike ? 7 : 0), -43, 22, -1.25, 1.25); ctx.stroke();
      ctx.strokeStyle = "#f4fff0"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(35 + (strike ? 7 : 0), -63); ctx.lineTo(strike ? 12 : 27, -43); ctx.lineTo(35 + (strike ? 7 : 0), -22); ctx.stroke();
    } else if (hero.id === "lancer") {
      legs("#743d58", "#ffe5ed");
      drawPixel(-18, -51, 35, 31, outline); drawPixel(-15, -48, 29, 27, "#df6686"); drawPixel(-14, -46, 8, 22, "#f69db4"); drawPixel(-24, -33, 12, 8, "#f4b0c2");
      drawPixel(-16, -67, 31, 23, skin); drawPixel(-19, -76, 35, 20, "#ed87a5"); drawPixel(-21, -66, 9, 27, "#d65f82");
      drawPixel(-12, -64, 8, 5, light); drawPixel(8, -61, 4, 4, "#4b4763");
      drawPixel(-12, -84, 8, 10, "#ffd0dc"); drawPixel(-6, -88, 8, 14, "#df6f91");
      drawPixel(-25, -69, 10, 11, "#f4a4ba"); drawPixel(-35, -64, 17, 9, "#d85e82"); drawPixel(-42, -58, 14, 8, "#b84870");
      const thrust = strike ? 18 : 0; drawPixel(6 + thrust, -45, 73, 5, "#f7e8cd"); drawPixel(5 + thrust, -44, 70, 2, "#fff9e9"); drawPixel(76 + thrust, -50, 16, 15, "#dc5e82"); drawPixel(88 + thrust, -46, 9, 7, "#ffb4c4");
    } else {
      legs("#435f85", "#edf7ff");
      drawPixel(-22, -50, 37, 30, outline); drawPixel(-19, -47, 31, 27, "#4f8fd0"); drawPixel(-17, -45, 9, 22, "#8dc7ef"); drawPixel(-25, -48, 9, 28, "#e8f5ff");
      drawPixel(-17, -67, 31, 23, skin); drawPixel(-19, -75, 34, 18, "#d7e9f4"); drawPixel(-20, -66, 8, 22, "#b9d4e7"); drawPixel(10, -64, 7, 21, "#a8c7df");
      drawPixel(-14, -64, 8, 5, light); drawPixel(7, -61, 4, 4, "#354c68");
      drawPixel(-23, -58, 12, 8, "#ffe176"); drawPixel(-28, -42, 17, 30, "#8ecdf1"); drawPixel(-25, -39, 11, 23, "#dff5ff");
      const swing = strike ? -34 : -4; ctx.save(); ctx.translate(13, -39); ctx.rotate(swing * Math.PI / 180); drawPixel(0, -4, 46, 7, "#dcefff"); drawPixel(3, -3, 39, 2, "#ffffff"); drawPixel(7, -8, 6, 15, "#ffd368"); ctx.restore();
    }
    if (!hero.down) {
      const hpW = 44, ratio = hero.hp / hero.stats.maxHp;
      drawPixel(-22, -90, hpW, 5, "rgba(34,49,65,.55)"); drawPixel(-21, -89, Math.max(0, (hpW - 2) * ratio), 3, ratio < .3 ? "#f06f78" : "#78d989");
    }
    ctx.restore();
  }

  function drawEnemy(enemy, time) {
    if (enemy.action === "dead" && enemy.actionT <= 0) return;
    const x = Math.round(enemy.x), y = GROUND;
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha = enemy.dead ? Math.max(0, enemy.actionT / .8) : 1;
    const bob = enemy.def.id === "dandelion" ? Math.sin(time * 4 + x) * 7 : Math.abs(Math.sin(time * 3 + x)) * 2;
    ctx.translate(0, -bob);
    drawPixel(-23, -2, 46, 6, "rgba(40,60,60,.22)");
    if (enemy.def.id === "slime" || enemy.def.id === "elite") {
      const scale = enemy.def.elite ? 1.55 : 1;
      ctx.scale(scale, scale);
      drawPixel(-20, -28, 40, 26, "#397855"); drawPixel(-17, -31, 34, 29, "#83d879");
      drawPixel(-10, -22, 5, 6, "#294b4f"); drawPixel(8, -22, 5, 6, "#294b4f");
      drawPixel(-3, -39, 6, 10, "#55964e"); drawPixel(-10, -46, 20, 9, enemy.def.elite ? "#ffd05e" : "#ed8eac");
      if (enemy.def.elite) drawPixel(-14, -52, 7, 10, "#f8cc4d");
    } else if (enemy.def.id === "mushroom") {
      drawPixel(-13, -37, 26, 34, "#e9d5ac"); drawPixel(-26, -53, 52, 22, "#e88378"); drawPixel(-18, -60, 36, 15, "#f1a58e");
      drawPixel(-7, -29, 4, 5, "#3f4e54"); drawPixel(6, -29, 4, 5, "#3f4e54");
      drawPixel(-30, -38, 14, 31, "#6d9d53");
    } else if (enemy.def.id === "dandelion") {
      drawPixel(-13, -40, 26, 27, "#ffe28a"); drawPixel(-20, -57, 8, 18, "#fff5c1"); drawPixel(-6, -62, 8, 22, "#fff5c1"); drawPixel(9, -58, 8, 19, "#fff5c1");
      drawPixel(-5, -31, 4, 4, "#405064"); drawPixel(6, -31, 4, 4, "#405064");
    } else if (enemy.def.boss) {
      drawPixel(-47, -61, 77, 57, "#f5e6bd"); drawPixel(14, -79, 34, 46, "#fff2cf");
      drawPixel(-34, -16, 11, 18, "#d1b680"); drawPixel(14, -16, 11, 18, "#d1b680");
      drawPixel(34, -71, 5, 5, "#315473");
      drawPixel(23, -99, 6, 28, "#8ee0e8"); drawPixel(42, -104, 6, 33, "#8ee0e8");
      drawPixel(9, -100, 20, 5, "#8ee0e8"); drawPixel(42, -106, 20, 5, "#8ee0e8");
      drawPixel(8, -89, 40, 12, "#6fba61"); drawPixel(16, -95, 8, 8, "#f2a5be"); drawPixel(32, -97, 8, 8, "#ffe678");
    }
    if (!enemy.dead) {
      const width = enemy.def.boss ? 110 : enemy.def.elite ? 70 : 46;
      drawPixel(-width / 2, enemy.def.boss ? -125 : -78, width, 6, "rgba(35,46,55,.56)");
      drawPixel(-width / 2 + 1, enemy.def.boss ? -124 : -77, (width - 2) * (enemy.hp / enemy.maxHp), 4, enemy.def.boss ? "#ed6d83" : "#81d77c");
      if (enemy.shield > 0) drawPixel(-width / 2, enemy.def.boss ? -132 : -85, width * Math.min(1, enemy.shield / (enemy.maxHp * .2)), 4, "#71c5ed");
      if (enemy.breakT > 0) drawPixel(-5, -94, 10, 6, "#ff9b5f");
      if (enemy.starT > 0) drawPixel(2, -108, 6, 6, "#d7c0ff");
    }
    ctx.restore();
  }

  function drawProjectiles() {
    game.projectiles.forEach(p => {
      if (p.delay > 0) return;
      if (p.type.includes("arrow")) {
        drawPixel(p.x - 10, p.y, 19, 3, p.type === "star-arrow" ? "#ffef87" : "#e7f7d5");
        drawPixel(p.x + 8, p.y - 2, 5, 7, p.type === "skill-arrow" ? "#7ff0a0" : "#9b7444");
      } else {
        ctx.fillStyle = p.type === "enemy-magic" ? "#ffec96" : "#d6c2ff";
        ctx.fillRect(p.x - 6, p.y - 6, 12, 12); ctx.fillStyle = "white"; ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
    });
  }

  function drawEffects() {
    game.effects.forEach(e => {
      const p = 1 - e.t / e.life;
      ctx.save(); ctx.globalAlpha = Math.min(1, e.t * 3); ctx.translate(e.x, e.y - (e.type === "text" ? p * 28 : 0));
      if (e.type === "text") { ctx.fillStyle = e.color; ctx.font = "bold 15px Microsoft YaHei"; ctx.textAlign = "center"; ctx.strokeStyle = "rgba(35,45,62,.7)"; ctx.lineWidth = 4; ctx.strokeText(e.text, 0, 0); ctx.fillText(e.text, 0, 0); }
      if (e.type === "spark" || e.type === "burst") {
        ctx.fillStyle = e.color;
        for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; ctx.fillRect(Math.cos(a) * p * 27 - 2, Math.sin(a) * p * 27 - 2, 5, 5); }
      }
      if (e.type === "slash") { ctx.strokeStyle = e.color; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(0, 0, 46 + p * 15, -1.15, 1.15); ctx.stroke(); }
      if (e.type === "thrust") { ctx.fillStyle = e.color; ctx.fillRect(-20, -3, 80 * (1 - p * .4), 6); }
      if (e.type === "starstorm") { ctx.fillStyle = e.color; for (let i = 0; i < 12; i++) { const a = i * 2.4; const r = 20 + i * 7 * p; ctx.fillRect(Math.cos(a) * r - 3, -45 + Math.sin(a) * 26 + p * 30, 7, 7); } }
      if (e.type === "vine") { ctx.strokeStyle = e.color; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-32, 20); ctx.quadraticCurveTo(0, -80 * (1 - p), 30, 12); ctx.stroke(); }
      if (e.type === "synergy") {
        ctx.strokeStyle = e.color; ctx.lineWidth = 7 - p * 4;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 24 + p * 58 + i * 11, 0, Math.PI * 2); ctx.stroke(); }
        ctx.fillStyle = "#ffffff"; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.fillRect(Math.cos(a) * (18 + p * 72) - 3, Math.sin(a) * (18 + p * 72) - 3, 7, 7); }
      }
      if (e.type === "guardlink") { ctx.strokeStyle = e.color; ctx.lineWidth = 5; ctx.setLineDash([12, 7]); ctx.beginPath(); ctx.moveTo(-80, 0); ctx.lineTo(80, 0); ctx.stroke(); ctx.setLineDash([]); }
      ctx.restore();
    });
  }

  function draw(time) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground(time);
    game.heroes.forEach(h => drawHero(h, time));
    game.enemies.forEach(e => drawEnemy(e, time));
    drawProjectiles();
    drawEffects();
    if (game.paused) {
      ctx.fillStyle = "rgba(20,35,55,.32)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "white"; ctx.font = "bold 28px Microsoft YaHei"; ctx.textAlign = "center"; ctx.fillText("冒险暂停", 480, 265);
    }
  }

  function frame(now) {
    const raw = Math.min(.12, (now - lastFrame) / 1000);
    lastFrame = now;
    accumulator += raw * game.speed;
    while (accumulator >= STEP) { update(STEP); accumulator -= STEP; }
    draw(now / 1000);
    uiClock += raw;
    if (uiClock > .12) { renderBattleHud(); uiClock = 0; }
    requestAnimationFrame(frame);
  }

  function renderTopUI() {
    $("#stageLabel").textContent = `1-${game.stageId}`;
    $("#levelLabel").textContent = state.level;
    $("#goldLabel").textContent = Math.floor(state.gold).toLocaleString("zh-CN");
    $("#shardWrap").hidden = !state.firstClears[10];
    $("#shardLabel").textContent = state.shards;
    $("#inventoryBadge").hidden = state.inventory.length === 0;
    $("#inventoryBadge").textContent = state.inventory.length;
    const planNames = { progress: "主线推进", gear: `装备刷取 · 第${state.planStage}关`, materials: `材料积累 · 第${state.planStage}关`, boss: "BOSS专注 · 第10关" };
    $("#modeLabel").textContent = planNames[state.idlePlan] || "主线推进";
    $("#modeButton").textContent = state.idlePlan === "progress" ? "切换装备刷取" : "恢复主线推进";
    const need = L.xpNeeded(state.level);
    $("#xpText").textContent = state.level >= 10 ? "冒险等级已满" : `冒险经验 ${Math.floor(state.xp)} / ${need}`;
    $("#xpFill").style.width = state.level >= 10 ? "100%" : `${state.xp / need * 100}%`;
    $("#speedButton").textContent = `×${game.speed}`;
    $("#soundButton").textContent = state.settings.sound ? "♪" : "×♪";
  }

  function updateStageUI() {
    $("#stageNumber").textContent = `STAGE ${String(game.stageId).padStart(2, "0")}`;
    $("#stageName").textContent = game.stage.name;
    $("#waveText").textContent = `WAVE ${game.waveIndex + 1} / ${game.stage.waves.length}`;
    $("#waveDots").innerHTML = game.stage.waves.map((_, i) => `<i class="${i < game.waveIndex ? "done" : i === game.waveIndex ? "active" : ""}"></i>`).join("");
    renderTopUI();
  }

  function renderBattleHud() {
    const status = game.paused ? "冒险暂停" : game.phase === "march" ? "自动行进中" : game.phase === "combat" ? "自动战斗中" : game.phase === "victory" ? "关卡完成" : game.phase === "defeat" ? "整备中" : "准备出发";
    $("#battleStatus").innerHTML = `<span class="pulse-dot"></span>${status}`;
    $("#partyHud").innerHTML = game.heroes.map(h => {
      const ratio = Math.max(0, h.hp / h.stats.maxHp * 100);
      const skill = Math.max(0, Math.min(100, (1 - h.skillCd / h.stats.skillCd) * 100));
      return `<article class="hero-card ${h.down ? "down" : ""}">
        <div class="portrait ${h.id}">${h.def.icon}</div>
        <div class="hero-meta"><header><b>${h.def.name}</b><span>${h.def.title}</span></header><div class="bar hp-bar"><i style="width:${ratio}%"></i></div></div>
        <div class="skill-meter" style="--skill:${skill}%"><span>${h.down ? "倒下" : h.skillCd <= 0 ? "READY" : Math.ceil(h.skillCd)}</span></div>
      </article>`;
    }).join("");
    const boss = game.enemies.find(e => e.def.boss && !e.dead);
    $("#bossBar").hidden = !boss;
    if (boss) {
      const ratio = boss.hp / boss.maxHp;
      const phase = ratio > .6 ? "第一阶段 · 花藤试探" : ratio > .3 ? "第二阶段 · 自然祝福与召唤" : "第三阶段 · 花冠守护";
      $("#bossName").textContent = boss.def.name; $("#bossHpFill").style.width = `${ratio * 100}%`;
      $("#bossHpText").textContent = `${Math.ceil(boss.hp)} / ${boss.maxHp}${boss.shield > 0 ? ` · 护盾 ${Math.ceil(boss.shield)}` : ""}`;
      $("#bossPhase").textContent = phase;
    }
    renderTopUI();
  }

  function openDrawer(view) {
    activeView = view;
    $$(".nav-button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    if (view === "battle") { closeDrawer(); return; }
    $("#drawerBackdrop").hidden = false; $("#drawer").hidden = false;
    const titles = { formation: ["冒险团管理", "编队与战术"], inventory: ["战利品管理", "背包"], map: ["晴风花原", "关卡地图"], skills: ["金币养成", "技能升级"], settings: ["本地游戏", "设置与存档"] };
    $("#drawerKicker").textContent = titles[view][0]; $("#drawerTitle").textContent = titles[view][1];
    if (view === "formation") renderFormation();
    if (view === "inventory") renderInventory();
    if (view === "map") renderMap();
    if (view === "skills") renderSkills();
    if (view === "settings") renderSettings();
  }

  function closeDrawer() {
    $("#drawerBackdrop").hidden = true; $("#drawer").hidden = true;
    activeView = "battle";
    $$(".nav-button").forEach(b => b.classList.toggle("active", b.dataset.view === "battle"));
  }

  function itemIcon(item) { return L.SLOT_ICONS[item.slot] || "◆"; }
  function itemStatsHtml(item) {
    const stats = [];
    if (item.stats.atk) stats.push(`<li>攻击力 +${item.stats.atk}</li>`);
    if (item.stats.hp) stats.push(`<li>最大生命 +${item.stats.hp}</li>`);
    if (item.stats.def) stats.push(`<li>防御力 +${item.stats.def}</li>`);
    L.itemAffixDetails(item).forEach(a => stats.push(`<li class="affix">${a.label}</li>`));
    return stats.join("");
  }

  function renderInventory() {
    const item = state.inventory.find(x => x.id === selectedItemId) || state.inventory[0] || null;
    selectedItemId = item ? item.id : null;
    const slots = state.inventory.map(it => { const q = L.qualityById(it.quality); return `<button class="item-slot ${it.id === selectedItemId ? "selected" : ""}" data-item="${it.id}" style="--rarity:${q.color}" title="${it.name}"><span class="item-icon">${itemIcon(it)}</span>${it.locked ? "<b>◆</b>" : ""}<small>Lv.${it.level}</small></button>`; }).join("");
    let detail = `<div class="empty-state">击败怪物后，装备会自动进入背包。<br>已穿戴装备不占背包容量。</div>`;
    if (item) {
      const q = L.qualityById(item.quality);
      const users = item.slot === "weapon" ? [item.charId] : state.formation;
      const legend = item.legendaryId ? Object.values(L.LEGENDARIES).find(x => x.id === item.legendaryId) : null;
      const comparisons = users.map(id => { const c = L.compareItem(state, item, id); return c ? `<div class="compare-row"><b>${L.CHARACTERS[id].name}</b><span class="${c.dpsPct >= 0 ? "up" : "down"}">伤害 ${c.dpsPct >= 0 ? "+" : ""}${Math.round(c.dpsPct * 100)}%</span><span class="${c.survivalPct >= 0 ? "up" : "down"}">生存 ${c.survivalPct >= 0 ? "+" : ""}${Math.round(c.survivalPct * 100)}%</span><small>${c.special.length ? `特殊：${c.special.join("、")}` : "无特殊联动变化"}</small></div>` : ""; }).join("");
      detail = `<div style="--rarity:${q.color}"><small>${L.SLOT_NAMES[item.slot]} · 物品等级 ${item.level}</small><h3 class="rarity-name">${q.name} · ${item.name}</h3><ul class="item-stats">${itemStatsHtml(item)}</ul>${legend ? `<div class="legend-effect"><b>传说能力</b><br>${legend.effect}</div>` : ""}<div class="compare-box"><b>替换收益预览</b>${comparisons}</div><p class="drop-source">掉落来源：${L.itemDropSource(item)}</p><div class="button-row">${users.map(id => `<button class="primary-button" data-equip="${id}">给${L.CHARACTERS[id].name}穿戴</button>`).join("")}<button class="secondary-button" data-lock>${item.locked ? "解除锁定" : "锁定"}</button><button class="secondary-button" data-salvage ${item.locked || item.quality === "legendary" ? "disabled" : ""}>分解</button></div></div>`;
    }
    $("#drawerBody").innerHTML = `<div class="inventory-tools"><span>容量 <b>${state.inventory.length}</b> / 60</span><button class="secondary-button" data-sort>按品质整理</button><button class="secondary-button" data-codex>装备图鉴</button></div><div class="inventory-layout"><section class="panel-card"><div class="inventory-grid">${slots || "<div class='empty-state'>背包还是空的</div>"}</div></section><section class="panel-card item-detail">${detail}</section></div>`;
  }

  function renderFormation() {
    const units = state.formation.map((id, index) => { const c = L.CHARACTERS[id]; return `<div class="formation-unit"><div class="portrait ${id}">${c.icon}</div><b>${c.name}</b><small>${c.title}</small><div class="reorder"><button data-move="${index}:left" ${index === 0 ? "disabled" : ""}>←</button><button data-move="${index}:right" ${index === 3 ? "disabled" : ""}>→</button></div></div>${index < 3 ? '<span class="formation-arrow">›</span>' : ""}`; }).join("");
    const tactics = Object.entries(L.TACTICS).map(([id, t]) => `<button class="tactic-card ${state.tactic === id ? "active" : ""}" data-tactic="${id}"><b>${t.name}</b><small>${t.desc}</small></button>`).join("");
    const presets = [["farm", "刷图套"], ["boss", "BOSS套"]].map(([id, name]) => `<div class="preset-card"><div><b>${name}</b><small>${state.presets[id] ? `已保存 · ${new Date(state.presets[id].savedAt).toLocaleDateString("zh-CN")}` : "尚未保存"}</small></div><button class="secondary-button" data-save-preset="${id}">保存当前</button><button class="primary-button" data-apply-preset="${id}" ${state.presets[id] ? "" : "disabled"}>一键换装</button></div>`).join("");
    $("#drawerBody").innerHTML = `<section class="panel-card"><div class="section-heading"><div><h3>横向站位</h3><small>左侧为后方，右侧最先接敌；下次关卡开始生效。</small></div></div><div class="formation-line">${units}<div class="enemy-marker">敌人<br>←</div></div></section><section class="panel-card"><div class="section-heading"><h3>自动战术</h3></div><div class="tactic-grid">${tactics}</div></section><section class="panel-card"><div class="section-heading"><div><h3>队伍预设</h3><small>站位、战术与全员装备一起保存。</small></div></div><div class="preset-grid">${presets}</div></section>`;
  }

  function renderMap() {
    const cards = L.STAGES.map(stage => {
      const locked = stage.id > state.unlockedStage;
      const rhythm = stage.id <= 3 ? "短巡逻" : stage.id <= 7 ? "遭遇＋精英" : stage.id < 10 ? "高压混战" : "三阶段首领";
      return `<button class="stage-card zone-${Math.ceil(stage.id / 3)} ${stage.id === game.stageId ? "active" : ""} ${locked ? "locked" : ""}" data-stage="${stage.id}" ${locked ? "disabled" : ""}><span class="stage-thumb">${stage.id === 10 ? "♞" : stage.id >= 8 ? "♜" : stage.id >= 5 ? "♛" : "❀"}</span><span class="stage-index">STAGE ${String(stage.id).padStart(2,"0")}</span><b>${stage.name}</b><small>${stage.purpose} · ${rhythm}</small>${state.firstClears[stage.id] ? '<span class="crown">★</span>' : ""}<span class="record">${state.bestTimes[stage.id] ? `BEST ${state.bestTimes[stage.id]}s` : locked ? "未解锁" : "可挑战"}</span></button>`;
    }).join("");
    const exchange = state.firstClears[10] ? `<section class="panel-card"><div class="section-heading"><div><h3>花冠工坊</h3><small>40枚花冠碎片可兑换一件指定传说武器。</small></div><b>${state.shards} / 40 ♛</b></div><div class="button-row">${Object.values(L.LEGENDARIES).map(x => `<button class="secondary-button" data-exchange="${x.id}" ${state.shards < 40 ? "disabled" : ""}>兑换${x.name}</button>`).join("")}</div></section>` : "";
    const plans = [["progress", "主线推进", "依次挑战新关卡"], ["gear", "装备刷取", "快速巡逻并筛选目标部位"], ["materials", "材料积累", "稳定关卡反复获取金币经验"], ["boss", "BOSS专注", "固定挑战花冠鹿灵"]].map(([id, name, desc]) => `<button class="plan-card ${state.idlePlan === id ? "active" : ""}" data-plan="${id}" ${id === "boss" && state.unlockedStage < 10 ? "disabled" : ""}><b>${name}</b><small>${desc}</small></button>`).join("");
    const focus = ["all", "weapon", "armor", "accessory"].map(id => `<button class="filter-chip ${state.lootFocus === id ? "active" : ""}" data-focus="${id}">${{all:"全部",weapon:"武器",armor:"防具",accessory:"饰品"}[id]}</button>`).join("");
    const boss = state.bossRecords;
    $("#drawerBody").innerHTML = `<section class="panel-card"><div class="section-heading"><div><h3>挂机计划</h3><small>计划会决定通关后的下一目标；重复关卡启用快速巡逻。</small></div></div><div class="plan-grid">${plans}</div><div class="focus-row"><span>装备目标</span>${focus}</div></section><section class="panel-card"><div class="section-heading"><div><h3>晴风花原</h3><small>选择关卡后会设为挂机目标。</small></div></div><div class="stage-grid">${cards}</div></section>${state.unlockedStage >= 10 ? `<section class="panel-card boss-record"><div class="section-heading"><div><h3>花冠鹿灵讨伐纪录</h3><small>阶段线：100—60% 花藤 · 60—30% 治疗召唤 · 30—0% 护盾</small></div></div><div class="record-grid"><div><b>${boss.wins}</b><small>胜利</small></div><div><b>${boss.bestTime || "—"}</b><small>最快秒数</small></div><div><b>${boss.bestDamage}</b><small>最高总伤害</small></div></div><button class="secondary-button" data-last-report ${state.lastBattleReport ? "" : "disabled"}>查看最近战报</button></section>` : ""}${exchange}`;
  }

  function renderSkills() {
    const list = state.formation.map(id => {
      const c = L.CHARACTERS[id], level = state.skills[id], cost = L.skillCost(level);
      const mult = Math.round((c.skillBase + .15 * (level - 1)) * 100);
      return `<article class="skill-card"><div class="skill-icon" style="color:${c.color}">${c.icon}</div><div><span class="skill-level">${c.name} · Lv.${level}/3</span><h3>${c.skill}</h3><p>当前总倍率约 ${mult}% · 冷却 ${c.skillCd} 秒<br>${level < 3 ? `升级后伤害倍率 +15%` : "已达到最高等级"}</p></div><button class="primary-button" data-skill="${id}" ${level >= 3 || state.gold < cost ? "disabled" : ""}>${level >= 3 ? "已满级" : `${cost}金币升级`}</button></article>`;
    }).join("");
    $("#drawerBody").innerHTML = `<div class="section-heading"><div><h3>主动技能强化</h3><small>四名少女共享冒险等级，技能分别提升。</small></div><b>${Math.floor(state.gold)} 金币</b></div><div class="skill-list">${list}</div>`;
  }

  function renderSettings() {
    const protect = ["synergy", "starlight", "inspire", "counter"].map(id => { const a = L.AFFIXES.find(x => x.id === id); return `<button class="filter-chip ${state.settings.protectedAffixes.includes(id) ? "active" : ""}" data-protect="${id}">${a.name}</button>`; }).join("");
    $("#drawerBody").innerHTML = `<div class="settings-grid"><section class="panel-card"><div class="section-heading"><h3>挂机偏好</h3></div><div class="setting-row"><span>自动分解普通装备</span><button class="toggle ${state.settings.autoCommon ? "on" : ""}" data-setting="autoCommon"></button></div><div class="setting-row"><span>自动分解魔法装备</span><button class="toggle ${state.settings.autoMagic ? "on" : ""}" data-setting="autoMagic"></button></div><div class="setting-row"><span>保留稀有及以上</span><button class="toggle ${state.settings.keepRare ? "on" : ""}" data-setting="keepRare"></button></div><div class="setting-row"><span>重复关卡快速巡逻</span><button class="toggle ${state.settings.quickPatrol ? "on" : ""}" data-setting="quickPatrol"></button></div><div class="setting-row"><span>战斗音效</span><button class="toggle ${state.settings.sound ? "on" : ""}" data-setting="sound"></button></div><p><small>自动分解低于指定等级：</small></p><div class="focus-row">${[0,5,8].map(n => `<button class="filter-chip ${Number(state.settings.autoBelowLevel) === n ? "active" : ""}" data-autolevel="${n}">${n ? `低于 Lv.${n}` : "关闭"}</button>`).join("")}</div><p><small>受保护词条不会被自动分解：</small></p><div class="focus-row">${protect}</div></section><section class="panel-card"><div class="section-heading"><h3>存档管理</h3></div><p><small>v2 存档兼容旧版本；进度、装备与设置均保存在本机。</small></p><textarea class="export-box" id="saveBox" placeholder="点击导出，或粘贴存档文本后导入"></textarea><div class="button-row"><button class="secondary-button" data-export>导出存档</button><button class="primary-button" data-import>导入存档</button><button class="danger-button" data-reset>重新开始</button></div></section></div><section class="panel-card"><div class="section-heading"><h3>冒险记录</h3></div><p>累计击败 <b>${state.totalKills}</b> 名敌人 · 通关 <b>${state.totalClears}</b> 次 · 史诗保底 ${state.pity.epic}/40 · 传说保底 ${state.pity.legendary}/180</p></section>`;
  }

  function showBattleReport(report) {
    if (!report) return toast("还没有可查看的战斗记录。", "error");
    const total = Math.max(1, report.totalDamage || 0);
    const rows = state.formation.map(id => `<div class="report-row"><b>${L.CHARACTERS[id].name}</b><span><i style="width:${Math.round((report.damageByHero?.[id] || 0) / total * 100)}%"></i></span><em>${Math.round(report.damageByHero?.[id] || 0)}伤害</em><small>承伤 ${Math.round(report.takenByHero?.[id] || 0)} · 技能 ${report.skillsByHero?.[id] || 0}次</small></div>`).join("");
    showModal(`<span class="eyebrow">BATTLE REPORT</span><h2 id="modalTitle">第${report.stage}关 · ${report.success ? "作战完成" : "挑战失败"}</h2><p>${report.reason || `用时 ${report.seconds} 秒，总伤害 ${report.totalDamage}。`}</p><div class="report-list">${rows}</div><div class="report-metrics"><div><b>${report.synergyBursts || 0}</b><small>协同爆发</small></div><div><b>${report.guardCombos || 0}</b><small>守望突击</small></div><div><b>${report.breakUptime || 0}%</b><small>破甲覆盖</small></div><div><b>${report.starUptime || 0}%</b><small>星痕覆盖</small></div></div>${report.bossHeal ? `<p class="warning-note">花冠鹿灵本次回复了 ${report.bossHeal} 点生命。</p>` : ""}<p class="drop-source">战利品：${report.loot?.length ? report.loot.map(x => x.name).join("、") : "无保留装备"}</p><div class="button-row"><button class="primary-button" data-close-modal>关闭战报</button></div>`, true);
  }

  function showCodex() {
    const legends = Object.values(L.LEGENDARIES).map(x => `<div class="codex-card ${state.legendarySeen.includes(x.id) ? "seen" : "unknown"}"><span>${L.CHARACTERS[x.charId].icon}</span><b>${state.legendarySeen.includes(x.id) ? x.name : "未发现的传说"}</b><small>${state.legendarySeen.includes(x.id) ? x.effect : "击败花冠鹿灵后有机会发现"}</small></div>`).join("");
    const affixes = L.AFFIXES.map(x => `<span class="filter-chip ${state.affixesSeen.includes(x.id) ? "active" : ""}">${state.affixesSeen.includes(x.id) ? x.name : "???"}</span>`).join("");
    showModal(`<span class="eyebrow">EQUIPMENT CODEX</span><h2 id="modalTitle">装备与传说图鉴</h2><p>发现词条 ${state.affixesSeen.length}/${L.AFFIXES.length} · 传说 ${state.legendarySeen.length}/4</p><div class="codex-grid">${legends}</div><h3>词条记录</h3><div class="focus-row">${affixes}</div>`, true);
  }

  function showLegendChoice() {
    const cards = Object.values(L.LEGENDARIES).map(x => `<button class="reward-card" data-legend="${x.id}"><span class="weapon-icon">${L.CHARACTERS[x.charId].icon}</span><b>${x.name}</b><small>${L.CHARACTERS[x.charId].name}专属</small></button>`).join("");
    showModal(`<span class="eyebrow">FIRST CLEAR REWARD</span><h2 id="modalTitle">选择一件传说武器</h2><p>花冠鹿灵认可了冒险团的勇气。首通奖励只能选择一件，其余武器可以通过重复挑战与花冠碎片获取。</p><div class="reward-grid">${cards}</div>`, false);
  }

  function showOffline(result) {
    showModal(`<span class="eyebrow">OFFLINE REWARD</span><h2 id="modalTitle">欢迎回来，团长！</h2><p>冒险团在第${result.stage}关继续巡游了 ${Math.floor(result.seconds / 60)} 分钟，按80%效率完成了 ${result.clears} 次等效挑战。</p><div class="offline-summary"><div><b>+${result.gold}</b><small>金币</small></div><div><b>+${result.xp}</b><small>经验</small></div><div><b>${result.equipment}</b><small>件保留装备</small></div></div><div class="button-row"><button class="primary-button" data-close-modal>收下奖励</button></div>`, true);
  }

  function bindEvents() {
    $("#startButton").addEventListener("click", () => { state.started = true; $("#startOverlay").hidden = true; startStage(state.currentStage); toast("战斗全程自动进行，点击底部功能管理冒险团。 "); });
    $("#pauseButton").addEventListener("click", () => { game.paused = !game.paused; $("#pauseButton").textContent = game.paused ? "▶" : "Ⅱ"; });
    $("#speedButton").addEventListener("click", () => { game.speed = game.speed === 1 ? 2 : game.speed === 2 ? 4 : 1; renderTopUI(); });
    $("#soundButton").addEventListener("click", () => { state.settings.sound = !state.settings.sound; L.save(state); renderTopUI(); });
    $("#modeButton").addEventListener("click", () => { const progress = state.idlePlan !== "progress"; state.idlePlan = progress ? "progress" : "gear"; state.mode = progress ? "progress" : "repeat"; state.planStage = game.stageId; L.save(state); renderTopUI(); toast(progress ? "已恢复主线推进。" : `已切换为第${game.stageId}关装备刷取。`); });
    $("#reportButton").addEventListener("click", () => showBattleReport(state.lastBattleReport));
    $$(".nav-button").forEach(b => b.addEventListener("click", () => openDrawer(b.dataset.view)));
    $("#closeDrawer").addEventListener("click", closeDrawer); $("#drawerBackdrop").addEventListener("click", closeDrawer);
    $("#modalClose").addEventListener("click", closeModal);

    $("#drawerBody").addEventListener("click", event => {
      const t = event.target.closest("button"); if (!t) return;
      if (t.dataset.item) { selectedItemId = t.dataset.item; renderInventory(); }
      if (t.dataset.equip) { const r = L.equipItem(state, selectedItemId, t.dataset.equip); r.ok ? toast(`已给${L.CHARACTERS[t.dataset.equip].name}穿戴装备。`) : toast(r.reason, "error"); L.save(state); renderInventory(); }
      if (t.hasAttribute("data-lock")) { const it = state.inventory.find(x => x.id === selectedItemId); if (it) { it.locked = !it.locked; L.save(state); renderInventory(); } }
      if (t.hasAttribute("data-salvage")) { const r = L.salvageItem(state, selectedItemId); if (r.ok) { selectedItemId = null; toast(`分解获得${r.gold}金币。`); L.save(state); renderInventory(); } else toast(r.reason, "error"); }
      if (t.hasAttribute("data-sort")) { state.inventory.sort((a,b) => L.QUALITIES.findIndex(q=>q.id===b.quality)-L.QUALITIES.findIndex(q=>q.id===a.quality)||b.level-a.level); renderInventory(); }
      if (t.dataset.move) { const [indexText, dir] = t.dataset.move.split(":"); const index = Number(indexText), next = index + (dir === "left" ? -1 : 1); [state.formation[index], state.formation[next]] = [state.formation[next], state.formation[index]]; L.save(state); renderFormation(); toast("新站位将在下一次进入关卡时生效。 "); }
      if (t.dataset.tactic) { state.tactic = t.dataset.tactic; L.save(state); renderFormation(); toast(`已切换为${L.TACTICS[state.tactic].name}。`); }
      if (t.dataset.stage) { state.mode = "repeat"; state.idlePlan = state.idlePlan === "progress" ? "gear" : state.idlePlan; state.planStage = Number(t.dataset.stage); startStage(Number(t.dataset.stage)); closeDrawer(); }
      if (t.dataset.plan) { state.idlePlan = t.dataset.plan; state.mode = t.dataset.plan === "progress" ? "progress" : "repeat"; if (t.dataset.plan === "boss") state.planStage = 10; L.save(state); renderMap(); renderTopUI(); toast(`挂机计划已切换为${{progress:"主线推进",gear:"装备刷取",materials:"材料积累",boss:"BOSS专注"}[t.dataset.plan]}。`); }
      if (t.dataset.focus) { state.lootFocus = t.dataset.focus; L.save(state); renderMap(); }
      if (t.dataset.savePreset) { L.savePreset(state, t.dataset.savePreset); L.save(state); renderFormation(); toast("当前站位、战术与装备已保存。", "gold"); }
      if (t.dataset.applyPreset) { const r = L.applyPreset(state, t.dataset.applyPreset); r.ok ? toast("预设已应用，将在下一关刷新战斗属性。", "gold") : toast(r.reason, "error"); L.save(state); renderFormation(); }
      if (t.dataset.protect) { const list = state.settings.protectedAffixes; const i = list.indexOf(t.dataset.protect); i >= 0 ? list.splice(i, 1) : list.push(t.dataset.protect); L.save(state); renderSettings(); }
      if (t.dataset.autolevel !== undefined) { state.settings.autoBelowLevel = Number(t.dataset.autolevel); L.save(state); renderSettings(); }
      if (t.hasAttribute("data-codex")) showCodex();
      if (t.hasAttribute("data-last-report")) showBattleReport(state.lastBattleReport);
      if (t.dataset.exchange && state.shards >= 40) { const item = L.generateItem(state, 10, { legendaryId: t.dataset.exchange }); state.shards -= 40; L.addItem(state, item); L.save(state); renderMap(); toast(`兑换成功：${item.name}`, "gold"); }
      if (t.dataset.skill) { const r = L.upgradeSkill(state, t.dataset.skill); r.ok ? toast(`${L.CHARACTERS[t.dataset.skill].skill}升至Lv.${r.level}！`, "gold") : toast(r.reason, "error"); L.save(state); renderSkills(); }
      if (t.dataset.setting) { state.settings[t.dataset.setting] = !state.settings[t.dataset.setting]; L.save(state); renderSettings(); renderTopUI(); }
      if (t.hasAttribute("data-export")) { $("#saveBox").value = L.exportSave(state); $("#saveBox").select(); toast("存档文本已生成。 "); }
      if (t.hasAttribute("data-import")) { try { state = L.importSave($("#saveBox").value); L.save(state); toast("存档导入成功。 "); closeDrawer(); startStage(state.currentStage); } catch (e) { toast(`导入失败：${e.message}`, "error"); } }
      if (t.hasAttribute("data-reset")) { if (confirm("确定清空当前进度并重新开始吗？")) { localStorage.removeItem(L.SAVE_KEY); location.reload(); } }
    });

    $("#modalContent").addEventListener("click", event => {
      const t = event.target.closest("button"); if (!t) return;
      if (t.dataset.legend) {
        const item = L.generateItem(state, 10, { legendaryId: t.dataset.legend });
        L.addItem(state, item); L.save(state); closeModal(); toast(`获得传说武器：${item.name}！`, "gold");
        transitionTimer = setTimeout(() => startStage(10), 1800);
      }
      if (t.hasAttribute("data-close-modal")) closeModal();
    });
    window.addEventListener("beforeunload", () => L.save(state));
    document.addEventListener("visibilitychange", () => { if (document.hidden) L.save(state); });
  }

  function init() {
    bindEvents();
    game.heroes = createHeroes(true);
    updateStageUI(); renderBattleHud();
    if (state.started) {
      $("#startOverlay").hidden = true;
      const previousLastSeen = state.lastSeen;
      const offline = L.calculateOffline(state, Date.now());
      if (offline && !offline.invalidTime) setTimeout(() => showOffline(offline), 450);
      else if (offline && offline.invalidTime) toast("检测到系统时间倒退，本次不生成离线收益。", "error");
      state.lastSeen = Date.now();
      startStage(state.currentStage, true);
      if (previousLastSeen) L.save(state);
    } else {
      game.phase = "idle";
      game.heroes.forEach(h => { h.action = "idle"; });
    }
    requestAnimationFrame(frame);
  }

  init();
})();
