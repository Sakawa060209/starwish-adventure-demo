(function (global) {
  "use strict";

  const SAVE_KEY = "starwish_demo_save_v1";
  const SAVE_VERSION = 3;

  const CHARACTERS = {
    mage: { id: "mage", name: "星璃", title: "星术师", weapon: "book", weaponName: "魔导书", icon: "✦", hp: 145, atk: 24, def: 4, interval: 1.8, crit: .05, range: 270, hpGrowth: 9, atkGrowth: 2.2, skill: "星屑风暴", skillCd: 10, skillBase: 1.4, color: "#a98ee8" },
    archer: { id: "archer", name: "叶音", title: "森林游侠", weapon: "bow", weaponName: "弓", icon: "➶", hp: 155, atk: 18, def: 5, interval: 1.2, crit: .17, range: 200, hpGrowth: 10, atkGrowth: 1.7, skill: "星羽连射", skillCd: 9, skillBase: 2.25, color: "#61bd82" },
    lancer: { id: "lancer", name: "希娅", title: "疾风枪姬", weapon: "spear", weaponName: "长枪", icon: "♢", hp: 210, atk: 20, def: 9, interval: 1.45, crit: .08, range: 72, hpGrowth: 15, atkGrowth: 2, skill: "疾风连刺", skillCd: 7, skillBase: 1.95, color: "#e87b9c" },
    knight: { id: "knight", name: "露米", title: "星辉剑士", weapon: "sword", weaponName: "单手剑", icon: "⚔", hp: 260, atk: 22, def: 16, interval: 1.35, crit: .05, range: 40, hpGrowth: 18, atkGrowth: 2, skill: "星花斩", skillCd: 8, skillBase: 1.6, color: "#62a2e2" }
  };

  const ENEMIES = {
    S: { id: "slime", name: "花灵史莱姆", hp: 95, atk: 12, def: 5, interval: 1.8, range: 30, speed: 34, xp: 1, gold: 1, icon: "●" },
    M: { id: "mushroom", name: "蘑菇卫兵", hp: 130, atk: 10, def: 14, interval: 2.1, range: 32, speed: 27, xp: 1.15, gold: 1.15, icon: "♟" },
    D: { id: "dandelion", name: "蒲公英精灵", hp: 75, atk: 14, def: 3, interval: 2, range: 250, speed: 25, xp: 1.05, gold: 1.1, icon: "✤" },
    E: { id: "elite", name: "花冠史莱姆王", hp: 410, atk: 24, def: 12, interval: 1.7, range: 38, speed: 25, xp: 3.2, gold: 4, elite: true, icon: "♛" },
    B: { id: "boss", name: "花冠鹿灵", hp: 1650, atk: 30, def: 20, interval: 1.8, range: 52, speed: 22, xp: 8, gold: 10, boss: true, icon: "♜" }
  };

  const STAGES = [
    { id: 1, name: "初次出发", waves: [["S", "S"], ["S", "S"]], purpose: "认识四种攻击方式" },
    { id: 2, name: "小小的防御者", waves: [["S", "S"], ["S", "M"]], purpose: "首次接触护盾" },
    { id: 3, name: "冒险团的成长", waves: [["S", "S"], ["M", "M"]], purpose: "积累装备与经验" },
    { id: 4, name: "来自远方的攻击", waves: [["S", "S", "M"], ["S", "D"], ["S", "S", "M"]], purpose: "应对远程敌人" },
    { id: 5, name: "花冠史莱姆王", waves: [["S", "S"], ["M", "D"], ["E", "S"]], purpose: "第一次精英挑战" },
    { id: 6, name: "队伍配合", waves: [["S", "D", "D"], ["M", "M"], ["S", "S", "D"]], purpose: "破甲与星印联动" },
    { id: 7, name: "新的武器", waves: [["M", "M"], ["S", "D", "D"], ["M", "D", "D"]], purpose: "检验单体输出" },
    { id: 8, name: "成长检验", waves: [["S", "M", "D"], ["S", "S", "D"], ["M", "M", "D"]], purpose: "多目标混合战" },
    { id: 9, name: "最后的准备", waves: [["M", "M", "D"], ["S", "D", "D"], ["M", "D", "D"]], purpose: "BOSS前成长检查" },
    { id: 10, name: "花冠鹿灵", waves: [["S", "M"], ["D", "D", "M"], ["B"]], purpose: "第一章最终挑战" }
  ];

  const QUALITIES = [
    { id: "common", name: "普通", color: "#aeb8c4", affixes: 0, weight: .55 },
    { id: "magic", name: "魔法", color: "#57bb72", affixes: 1, weight: .30 },
    { id: "rare", name: "稀有", color: "#4e8de2", affixes: 2, weight: .115 },
    { id: "epic", name: "史诗", color: "#9d67dd", affixes: 3, weight: .03 },
    { id: "legendary", name: "传说", color: "#e4ad28", affixes: 2, weight: .005 }
  ];

  const AFFIXES = [
    { id: "sharp", name: "锋利", slots: ["weapon"], stat: "atkPct", min: .05, max: .12, format: pct },
    { id: "precise", name: "精准", slots: ["weapon", "accessory"], stat: "crit", min: .02, max: .05, format: pct },
    { id: "fervor", name: "狂热", slots: ["weapon", "accessory"], stat: "speed", min: .03, max: .10, format: pct },
    { id: "deadly", name: "致命", slots: ["weapon"], stat: "critDmg", min: .08, max: .20, format: pct },
    { id: "tenacious", name: "坚韧", slots: ["armor"], stat: "hpPct", min: .05, max: .12, format: pct },
    { id: "guard", name: "守护", slots: ["armor", "accessory"], stat: "defPct", min: .08, max: .18, format: pct },
    { id: "regen", name: "再生", slots: ["armor", "accessory"], stat: "regen", min: .002, max: .006, format: pct },
    { id: "agile", name: "灵巧", slots: ["accessory"], stat: "cdr", min: .03, max: .08, format: pct },
    { id: "synergy", name: "协同", slots: ["weapon", "accessory"], stat: "armorBreakDmg", min: .05, max: .12, format: pct },
    { id: "starlight", name: "星辉", slots: ["weapon", "accessory"], stat: "starDmg", min: .05, max: .12, format: pct },
    { id: "inspire", name: "鼓舞", slots: ["accessory"], stat: "inspire", min: .05, max: .05, special: true, format: pct },
    { id: "counter", name: "反击", slots: ["armor"], stat: "counter", min: .15, max: .15, special: true, format: pct }
  ];

  const LEGENDARIES = {
    knight: { id: "star-sword", charId: "knight", name: "星痕之剑", effect: "守护姿态触发后，下一次普通攻击额外释放80%攻击力的星光剑气。" },
    lancer: { id: "wind-spear", charId: "lancer", name: "风行之枪", effect: "攻击破甲目标时，有25%概率追加一次60%攻击力的弱化突刺。" },
    archer: { id: "star-bow", charId: "archer", name: "星羽长弓", effect: "每三次有效普通攻击后，下一击额外发射两支50%攻击力的星羽。" },
    mage: { id: "moon-book", charId: "mage", name: "月辉魔导书", effect: "星屑风暴命中时，额外产生一次60%攻击力的范围星爆。" }
  };

  const SLOT_NAMES = { weapon: "武器", armor: "防具", accessory: "饰品" };
  const SLOT_ICONS = { weapon: "⚔", armor: "⬟", accessory: "◆" };
  const TACTICS = {
    balanced: { name: "均衡模式", desc: "稳定锁定最近威胁，技能就绪后自动释放。" },
    assault: { name: "突击模式", desc: "远程角色优先收割残血目标，加快清场。" },
    guard: { name: "守护模式", desc: "露米优先拦截，远程角色保持更安全距离。" }
  };

  function pct(value) { return `${Math.round(value * 100)}%`; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function xpNeeded(level) { return level >= 10 ? 0 : 30 + 15 * (level - 1) + 2 * Math.pow(level - 1, 2); }
  function hpMultiplier(stage) { return 1 + .11 * (stage - 1); }
  function atkMultiplier(stage) { return 1 + .06 * (stage - 1); }
  function damage(atk, multiplier, def, bonus, crit, critDmg) {
    const base = atk * multiplier * (1 + (bonus || 0));
    return Math.max(1, Math.floor(base * (1 - def / (def + 100)) * (crit ? critDmg : 1)));
  }

  function rngNext(state) {
    let x = state.rngState || 123456789;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    state.rngState = x >>> 0;
    return state.rngState / 4294967296;
  }
  function randRange(state, min, max) { return min + (max - min) * rngNext(state); }
  function pick(state, arr) { return arr[Math.floor(rngNext(state) * arr.length)]; }
  function uid(state) { return `i${Date.now().toString(36)}${(state.itemSerial++).toString(36)}${Math.floor(rngNext(state) * 999).toString(36)}`; }

  function starterItem(state, charId, slot) {
    const char = CHARACTERS[charId];
    const base = { id: uid(state), slot, level: 1, quality: "common", affixes: [], locked: false, created: Date.now() };
    if (slot === "weapon") return Object.assign(base, { name: `练习用${char.weaponName}`, weapon: char.weapon, charId, stats: { atk: 4 } });
    if (slot === "armor") return Object.assign(base, { name: "旅行轻甲", stats: { hp: 20, def: 3 } });
    return Object.assign(base, { name: "新芽护符", stats: { atk: 1 } });
  }

  function freshState(seed) {
    const state = {
      version: SAVE_VERSION,
      started: false,
      level: 1,
      xp: 0,
      gold: 0,
      shards: 0,
      currentStage: 1,
      unlockedStage: 1,
      mode: "progress",
      idlePlan: "progress",
      planStage: 1,
      lootFocus: "all",
      tactic: "balanced",
      formation: ["mage", "archer", "lancer", "knight"],
      skills: { mage: 1, archer: 1, lancer: 1, knight: 1 },
      equipment: { mage: {}, archer: {}, lancer: {}, knight: {} },
      inventory: [],
      firstClears: {},
      highestClearedStage: 0,
      bestTimes: {},
      history: {},
      pity: { epic: 0, legendary: 0 },
      legendarySeen: [],
      affixesSeen: [],
      presets: { farm: null, boss: null },
      bossRecords: { wins: 0, bestTime: null, bestDamage: 0, drops: [] },
      lastBattleReport: null,
      failures: 0,
      lastStableStage: 1,
      pendingLegendaryChoice: false,
      legendaryRewardClaimed: false,
      offlineRemainder: 0,
      lastSeen: Date.now(),
      totalKills: 0,
      totalClears: 0,
      itemSerial: 1,
      rngState: seed || ((Date.now() ^ 0x51f15e) >>> 0),
      settings: {
        sound: true,
        autoCommon: false,
        autoMagic: false,
        autoAdvance: true,
        quickPatrol: true,
        keepRare: true,
        autoBelowLevel: 0,
        protectedAffixes: ["synergy", "starlight"]
      },
      pendingTutorial: 1
    };
    Object.keys(CHARACTERS).forEach(charId => {
      state.equipment[charId] = {
        weapon: starterItem(state, charId, "weapon"),
        armor: starterItem(state, charId, "armor"),
        accessory: starterItem(state, charId, "accessory")
      };
    });
    return state;
  }

  function normalizeState(input) {
    const base = freshState(987654321);
    if (!input || typeof input !== "object") return base;
    const out = Object.assign({}, base, input);
    out.settings = Object.assign({}, base.settings, input.settings || {});
    out.pity = Object.assign({}, base.pity, input.pity || {});
    out.skills = Object.assign({}, base.skills, input.skills || {});
    out.equipment = Object.assign({}, base.equipment, input.equipment || {});
    Object.keys(CHARACTERS).forEach(id => { out.equipment[id] = Object.assign({}, base.equipment[id], (input.equipment || {})[id] || {}); });
    out.presets = Object.assign({}, base.presets, input.presets || {});
    out.bossRecords = Object.assign({}, base.bossRecords, input.bossRecords || {});
    out.settings.protectedAffixes = Array.isArray(out.settings.protectedAffixes) ? out.settings.protectedAffixes.filter(id => AFFIXES.some(a => a.id === id)) : base.settings.protectedAffixes;
    out.legendarySeen = Array.isArray(out.legendarySeen) ? out.legendarySeen.filter(id => Object.values(LEGENDARIES).some(x => x.id === id)) : [];
    out.affixesSeen = Array.isArray(out.affixesSeen) ? out.affixesSeen.filter(id => AFFIXES.some(a => a.id === id)) : [];
    out.formation = Array.isArray(input.formation) && input.formation.length === 4 ? input.formation.filter(id => CHARACTERS[id]) : base.formation;
    if (out.formation.length !== 4 || new Set(out.formation).size !== 4) out.formation = base.formation;
    out.inventory = Array.isArray(input.inventory) ? input.inventory.slice(0, 120) : [];
    out.level = clamp(Number(out.level) || 1, 1, 10);
    out.unlockedStage = clamp(Number(out.unlockedStage) || 1, 1, 10);
    out.currentStage = clamp(Number(out.currentStage) || 1, 1, out.unlockedStage);
    out.lastSeen = Number(out.lastSeen) || Date.now();
    out.idlePlan = out.idlePlan === "materials" ? "gear" : (["progress", "gear", "boss"].includes(out.idlePlan) ? out.idlePlan : "progress");
    out.planStage = clamp(Number(out.planStage) || out.currentStage, 1, out.unlockedStage);
    out.lootFocus = ["all", "weapon", "armor", "accessory"].includes(out.lootFocus) ? out.lootFocus : "all";
    out.highestClearedStage = clamp(Number(out.highestClearedStage) || Object.keys(out.firstClears || {}).filter(k => out.firstClears[k]).reduce((m, k) => Math.max(m, Number(k) || 0), 0), 0, 10);
    out.lastStableStage = clamp(Number(out.lastStableStage) || 1, 1, Math.max(1, out.unlockedStage));
    // V0.7 did not persist the stage-10 choice dialog. A legacy save that has
    // cleared the boss but owns no legendary is safely resumed at the choice.
    if (Number(input.version || 1) < 3 && out.firstClears?.[10]) {
      const owned = out.inventory.some(item => item?.legendaryId) || Object.values(out.equipment).some(slots => Object.values(slots || {}).some(item => item?.legendaryId));
      out.legendaryRewardClaimed = owned;
      out.pendingLegendaryChoice = !owned;
    } else {
      out.legendaryRewardClaimed = !!out.legendaryRewardClaimed;
      out.pendingLegendaryChoice = !!out.pendingLegendaryChoice && !out.legendaryRewardClaimed;
    }
    out.lastStableStage = stableStageFor(out);
    out.version = SAVE_VERSION;
    return out;
  }

  function qualityById(id) { return QUALITIES.find(q => q.id === id) || QUALITIES[0]; }

  function chooseQuality(state, forcedMin, affectsPity) {
    const trackPity = affectsPity !== false;
    let idx = 0;
    if (trackPity && state.pity.legendary >= 180) idx = 4;
    else if (trackPity && state.pity.epic >= 40) idx = 3;
    else {
      const roll = rngNext(state);
      let acc = 0;
      for (let i = 0; i < QUALITIES.length; i++) {
        acc += QUALITIES[i].weight;
        if (roll < acc) { idx = i; break; }
      }
    }
    if (forcedMin) idx = Math.max(idx, QUALITIES.findIndex(q => q.id === forcedMin));
    if (trackPity) {
      state.pity.epic = idx >= 3 ? 0 : state.pity.epic + 1;
      state.pity.legendary = idx >= 4 ? 0 : state.pity.legendary + 1;
    }
    return QUALITIES[idx];
  }

  function generateItem(state, stage, options) {
    options = options || {};
    const level = clamp(stage + pick(state, [-1, 0, 0, 0, 1]), 1, 10);
    let slot = options.slot || pick(state, ["weapon", "armor", "accessory"]);
    let charId = options.charId || (slot === "weapon" ? pick(state, Object.keys(CHARACTERS)) : null);
    let legendary = options.legendaryId ? Object.values(LEGENDARIES).find(x => x.id === options.legendaryId) : null;
    if (legendary) { slot = "weapon"; charId = legendary.charId; }
    let quality = legendary ? qualityById("legendary") : chooseQuality(state, options.minQuality, options.affectsPity);
    if (quality.id === "legendary" && !legendary) legendary = LEGENDARIES[charId || pick(state, Object.keys(CHARACTERS))];
    if (legendary) { charId = legendary.charId; slot = "weapon"; }
    const char = charId ? CHARACTERS[charId] : null;
    const stats = {};
    let baseName = "";
    if (slot === "weapon") { stats.atk = 2 + 2 * level; baseName = char.weaponName; }
    if (slot === "armor") { stats.hp = 12 + 8 * level; stats.def = 2 + level; baseName = pick(state, ["花叶轻甲", "旅团披风", "星纹护衣"]); }
    if (slot === "accessory") { stats.atk = 1 + Math.floor(level / 2); baseName = pick(state, ["风铃护符", "新月耳坠", "星芽徽章"]); }
    const allowed = AFFIXES.filter(a => a.slots.includes(slot));
    const affixes = [];
    (options.forceAffixes || []).forEach(id => {
      const def = allowed.find(a => a.id === id);
      if (def && affixes.length < quality.affixes && !affixes.some(a => a.id === id)) {
        affixes.push({ id: def.id, value: Number(def.max.toFixed(4)) });
      }
    });
    while (affixes.length < quality.affixes && affixes.length < allowed.length) {
      const affix = pick(state, allowed);
      if (!affixes.some(a => a.id === affix.id)) affixes.push({ id: affix.id, value: Number(randRange(state, affix.min, affix.max).toFixed(4)) });
    }
    const prefixes = { common: "朴素的", magic: "翠风", rare: "苍星", epic: "幻月", legendary: "" };
    const item = {
      id: uid(state), slot, level, quality: quality.id, charId,
      weapon: char ? char.weapon : null,
      name: legendary ? legendary.name : `${prefixes[quality.id]}${baseName}`,
      stats, affixes, legendaryId: legendary ? legendary.id : null,
      locked: quality.id === "legendary", created: Date.now()
    };
    if (legendary && !state.legendarySeen.includes(legendary.id)) state.legendarySeen.push(legendary.id);
    affixes.forEach(a => { if (!state.affixesSeen.includes(a.id)) state.affixesSeen.push(a.id); });
    return item;
  }

  function addItem(state, item) {
    const q = qualityById(item.quality);
    const protectedAffix = (item.affixes || []).some(a => (state.settings.protectedAffixes || []).includes(a.id));
    const protectedQuality = state.settings.keepRare && ["rare", "epic", "legendary"].includes(item.quality);
    const belowLevel = Number(state.settings.autoBelowLevel) > 0 && item.level < Number(state.settings.autoBelowLevel);
    const shouldSalvage = !protectedAffix && !protectedQuality && ((item.quality === "common" && state.settings.autoCommon) || (item.quality === "magic" && state.settings.autoMagic) || belowLevel);
    if (shouldSalvage && item.quality !== "legendary" && !item.locked) {
      const gold = 4 + item.level * (q.id === "magic" ? 2 : 1);
      state.gold += gold;
      return { kept: false, gold };
    }
    if (state.inventory.length >= 60) {
      if (item.quality === "legendary" || item.locked) {
        state.inventory.push(item);
        return { kept: true, overflow: true };
      }
      const gold = 5 + item.level * (1 + QUALITIES.indexOf(q));
      state.gold += gold;
      return { kept: false, gold, overflow: true };
    }
    state.inventory.push(item);
    return { kept: true };
  }

  function itemAffixDetails(item) {
    return (item.affixes || []).map(a => {
      const def = AFFIXES.find(x => x.id === a.id);
      return def ? { name: def.name, stat: def.stat, value: a.value, label: `${def.name} +${def.format(a.value)}` } : null;
    }).filter(Boolean);
  }

  function characterStats(state, charId) {
    const def = CHARACTERS[charId];
    const levelOffset = state.level - 1;
    const raw = {
      maxHp: def.hp + def.hpGrowth * levelOffset,
      atk: def.atk + def.atkGrowth * levelOffset,
      def: def.def,
      crit: def.crit,
      critDmg: 1.5,
      speed: 0,
      cdr: 0,
      regen: 0,
      armorBreakDmg: 0,
      starDmg: 0,
      inspire: 0,
      counter: 0,
      legendaryId: null,
      interval: def.interval,
      skillCd: def.skillCd
    };
    let hpPct = 0, atkPct = 0, defPct = 0;
    Object.values(state.equipment[charId] || {}).filter(Boolean).forEach(item => {
      raw.maxHp += item.stats.hp || 0;
      raw.atk += item.stats.atk || 0;
      raw.def += item.stats.def || 0;
      if (item.legendaryId) raw.legendaryId = item.legendaryId;
      itemAffixDetails(item).forEach(a => {
        if (a.stat === "hpPct") hpPct += a.value;
        else if (a.stat === "atkPct") atkPct += a.value;
        else if (a.stat === "defPct") defPct += a.value;
        else raw[a.stat] = (raw[a.stat] || 0) + a.value;
      });
    });
    raw.maxHp = Math.round(raw.maxHp * (1 + hpPct));
    raw.atk = Math.round(raw.atk * (1 + atkPct));
    raw.def = Math.round(raw.def * (1 + defPct));
    raw.crit = clamp(raw.crit, 0, .6);
    raw.critDmg = clamp(raw.critDmg, 1.5, 3);
    raw.speed = clamp(raw.speed, 0, 1);
    raw.cdr = clamp(raw.cdr, 0, .3);
    raw.interval = def.interval / (1 + raw.speed);
    raw.skillCd = def.skillCd * (1 - raw.cdr);
    return raw;
  }

  function compareItem(state, item, charId) {
    if (!item || !CHARACTERS[charId] || item.slot === "weapon" && item.charId !== charId) return null;
    const before = characterStats(state, charId);
    const preview = normalizeState(JSON.parse(JSON.stringify(state)));
    preview.equipment[charId][item.slot] = JSON.parse(JSON.stringify(item));
    const after = characterStats(preview, charId);
    const beforeDps = before.atk / before.interval * (1 + before.crit * (before.critDmg - 1));
    const afterDps = after.atk / after.interval * (1 + after.crit * (after.critDmg - 1));
    const beforeSurvival = before.maxHp * (1 + before.def / 100);
    const afterSurvival = after.maxHp * (1 + after.def / 100);
    return {
      atk: after.atk - before.atk,
      hp: after.maxHp - before.maxHp,
      def: after.def - before.def,
      dpsPct: beforeDps ? (afterDps / beforeDps - 1) : 0,
      survivalPct: beforeSurvival ? (afterSurvival / beforeSurvival - 1) : 0,
      special: itemAffixDetails(item).filter(a => ["armorBreakDmg", "starDmg", "inspire", "counter"].includes(a.stat)).map(a => a.name)
    };
  }

  function equipItem(state, itemId, charId) {
    const index = state.inventory.findIndex(x => x.id === itemId);
    if (index < 0 || !CHARACTERS[charId]) return { ok: false, reason: "找不到这件装备。" };
    const item = state.inventory[index];
    if (item.slot === "weapon" && item.charId !== charId) return { ok: false, reason: `这件武器仅限${CHARACTERS[item.charId].name}使用。` };
    const old = state.equipment[charId][item.slot];
    state.inventory.splice(index, 1);
    state.equipment[charId][item.slot] = item;
    if (old) state.inventory.push(old);
    return { ok: true, old };
  }

  function salvageItem(state, itemId) {
    const index = state.inventory.findIndex(x => x.id === itemId);
    if (index < 0) return { ok: false, reason: "找不到这件装备。" };
    const item = state.inventory[index];
    if (item.locked || item.quality === "legendary") return { ok: false, reason: "锁定或传说装备不能分解。" };
    const value = 5 + item.level * (1 + QUALITIES.findIndex(q => q.id === item.quality));
    state.inventory.splice(index, 1);
    state.gold += value;
    return { ok: true, gold: value };
  }

  function savePreset(state, presetId) {
    if (!["farm", "boss"].includes(presetId)) return { ok: false, reason: "预设类型无效。" };
    const equipmentIds = {};
    Object.keys(CHARACTERS).forEach(charId => {
      equipmentIds[charId] = {};
      Object.entries(state.equipment[charId] || {}).forEach(([slot, item]) => { equipmentIds[charId][slot] = item ? item.id : null; });
    });
    state.presets[presetId] = { formation: [...state.formation], tactic: state.tactic, equipmentIds, savedAt: Date.now() };
    return { ok: true };
  }

  function applyPreset(state, presetId) {
    const preset = state.presets[presetId];
    if (!preset) return { ok: false, reason: "这个预设还没有保存。" };
    const pool = [];
    state.inventory.forEach(item => pool.push(item));
    Object.values(state.equipment).forEach(slots => Object.values(slots || {}).forEach(item => { if (item) pool.push(item); }));
    const byId = new Map(pool.map(item => [item.id, item]));
    const used = new Set();
    const nextEquipment = {};
    Object.keys(CHARACTERS).forEach(charId => {
      nextEquipment[charId] = {};
      ["weapon", "armor", "accessory"].forEach(slot => {
        const wanted = preset.equipmentIds?.[charId]?.[slot];
        const item = wanted ? byId.get(wanted) : null;
        if (item && !used.has(item.id) && (slot !== "weapon" || item.charId === charId)) {
          nextEquipment[charId][slot] = item;
          used.add(item.id);
        } else {
          const fallback = state.equipment[charId][slot] || null;
          nextEquipment[charId][slot] = fallback && !used.has(fallback.id) ? fallback : null;
          if (nextEquipment[charId][slot]) used.add(nextEquipment[charId][slot].id);
        }
      });
    });
    const equippedIds = new Set(Object.values(nextEquipment).flatMap(slots => Object.values(slots).filter(Boolean).map(item => item.id)));
    state.inventory = pool.filter(item => !equippedIds.has(item.id)).filter((item, index, arr) => arr.findIndex(x => x.id === item.id) === index).slice(0, 120);
    state.equipment = nextEquipment;
    state.formation = Array.isArray(preset.formation) ? [...preset.formation] : state.formation;
    state.tactic = TACTICS[preset.tactic] ? preset.tactic : state.tactic;
    return { ok: true };
  }

  function addExperience(state, amount) {
    if (state.level >= 10) return 0;
    state.xp += amount;
    let levels = 0;
    while (state.level < 10 && state.xp >= xpNeeded(state.level)) {
      state.xp -= xpNeeded(state.level);
      state.level++;
      levels++;
    }
    if (state.level >= 10) state.xp = 0;
    return levels;
  }

  function skillCost(level) { return level === 1 ? 100 : level === 2 ? 250 : 0; }
  function upgradeSkill(state, charId) {
    const level = state.skills[charId] || 1;
    if (level >= 3) return { ok: false, reason: "技能已达到最高等级。" };
    const cost = skillCost(level);
    if (state.gold < cost) return { ok: false, reason: `还需要${cost - state.gold}金币。` };
    state.gold -= cost;
    state.skills[charId] = level + 1;
    return { ok: true, level: level + 1 };
  }

  function rewardForEnemy(stage, enemyDef) {
    return {
      xp: Math.round((5 + 2 * stage) * enemyDef.xp),
      gold: Math.round((4 + 2 * stage) * enemyDef.gold)
    };
  }

  function recentStageStats(state, stage) {
    const recent = (state.history?.[stage] || []).slice(-10);
    const wins = recent.filter(run => run.success);
    const timedOut = recent.some(run => run.timeout);
    const winRate = recent.length ? wins.length / recent.length : 0;
    const times = wins.map(run => Number(run.seconds)).filter(value => Number.isFinite(value) && value > 0 && value <= 240).sort((a, b) => a - b);
    const trimmed = times.length >= 5 ? times.slice(1, -1) : times;
    const average = trimmed.length ? trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length : null;
    return { samples: recent.length, wins: wins.length, winRate, timedOut, average: average ? Math.round(average * 10) / 10 : null };
  }

  function stableStageFor(state) {
    let verified = 0;
    for (let stage = 1; stage <= 10; stage++) {
      const stats = recentStageStats(state, stage);
      if (stats.samples >= 10 && stats.wins >= 9 && !stats.timedOut) verified = stage;
    }
    if (verified) return verified;
    // Until a ten-run sample exists, stay one stage below the highest clear.
    // This avoids turning a lucky boss clear into an unsafe offline assignment.
    return clamp(Math.max(1, (state.highestClearedStage || 1) - 1), 1, 10);
  }

  function recordRun(state, stage, success, seconds, report) {
    if (!state.history[stage]) state.history[stage] = [];
    const timeout = !success && /超时|时间/.test(report?.reason || "");
    state.history[stage].push({ success: !!success, timeout, seconds: Math.round(seconds * 10) / 10, at: Date.now() });
    state.history[stage] = state.history[stage].slice(-10);
    if (success) {
      state.totalClears++;
      state.highestClearedStage = Math.max(state.highestClearedStage || 0, Number(stage));
      if (!state.bestTimes[stage] || seconds < state.bestTimes[stage]) state.bestTimes[stage] = Math.round(seconds * 10) / 10;
    }
    state.lastStableStage = stableStageFor(state);
    if (report) state.lastBattleReport = report;
    if (Number(stage) === 10 && report) {
      state.bossRecords.bestDamage = Math.max(state.bossRecords.bestDamage || 0, report.totalDamage || 0);
      if (success) {
        state.bossRecords.wins = (state.bossRecords.wins || 0) + 1;
        if (!state.bossRecords.bestTime || seconds < state.bossRecords.bestTime) state.bossRecords.bestTime = Math.round(seconds * 10) / 10;
      }
    }
  }

  function prepareLegendaryChoice(state) {
    if (state.legendaryRewardClaimed) return false;
    state.pendingLegendaryChoice = true;
    return true;
  }

  function claimLegendaryChoice(state, legendaryId) {
    if (!state.pendingLegendaryChoice || state.legendaryRewardClaimed) return { ok: false, reason: "这份首通奖励已经领取。" };
    const legendary = Object.values(LEGENDARIES).find(item => item.id === legendaryId);
    if (!legendary) return { ok: false, reason: "传说装备选择无效。" };
    const item = generateItem(state, 10, { legendaryId, affectsPity: false });
    const added = addItem(state, item);
    state.pendingLegendaryChoice = false;
    state.legendaryRewardClaimed = true;
    return { ok: true, item, added };
  }

  function itemDropSource(item) {
    if (item?.legendaryId) return "花冠鹿灵：首通选择、1%掉落或40碎片兑换";
    if (item?.slot === "weapon") return "第3、7关首通与所有已解锁关卡";
    if (item?.quality === "epic") return "第7—10关效率更高（全局史诗保底共享）";
    return "晴风花原所有关卡；高关卡提供更高物品等级";
  }

  function calculateOffline(state, now) {
    now = now || Date.now();
    const delta = now - state.lastSeen;
    state.lastSeen = now;
    if (delta < 60000 || delta < 0) return delta < 0 ? { invalidTime: true } : null;
    const seconds = Math.min(delta / 1000, 8 * 3600);
    const bossPlan = state.idlePlan === "boss" && state.unlockedStage >= 10;
    const stage = bossPlan ? 10 : clamp(stableStageFor(state), 1, 10);
    const stageStats = recentStageStats(state, stage);
    const average = Math.max(55, stageStats.average || (75 + stage * 4));
    const winRate = stageStats.samples ? clamp(stageStats.winRate, .5, 1) : .8;
    const efficiency = .8 * winRate;
    const clearsFloat = seconds * efficiency / average + (state.offlineRemainder || 0);
    const clears = Math.floor(clearsFloat);
    state.offlineRemainder = clearsFloat - clears;
    if (clears < 1) return null;
    const stageDef = STAGES[stage - 1];
    const enemyCodes = stageDef.waves.flat();
    let gold = 0, xp = 0, equipment = 0, salvaged = 0, shards = 0;
    const simulatedClears = Math.min(clears, 500);
    for (let c = 0; c < simulatedClears; c++) {
      enemyCodes.forEach(code => {
        const reward = rewardForEnemy(stage, ENEMIES[code]);
        gold += reward.gold;
        xp += reward.xp;
        const guaranteed = code === "E" || code === "B";
        if (guaranteed || rngNext(state) < .18) {
          const item = generateItem(state, stage, { minQuality: guaranteed ? "rare" : null, affectsPity: !guaranteed });
          const result = addItem(state, item);
          if (result.kept) equipment++; else salvaged += result.gold || 0;
        }
      });
    }
    if (clears > simulatedClears) {
      const scale = clears - simulatedClears;
      const perClearGold = enemyCodes.reduce((sum, code) => sum + rewardForEnemy(stage, ENEMIES[code]).gold, 0);
      const perClearXp = enemyCodes.reduce((sum, code) => sum + rewardForEnemy(stage, ENEMIES[code]).xp, 0);
      gold += perClearGold * scale;
      xp += perClearXp * scale;
    }
    state.gold += gold;
    if (bossPlan) {
      shards = clears;
      state.shards += shards;
    }
    const levels = addExperience(state, xp);
    return { seconds, stage, clears, gold: gold + salvaged, xp, equipment, salvaged, levels, shards, average, winRate, efficiency, bossPlan };
  }

  function save(state) {
    state.lastSeen = Date.now();
    if (typeof localStorage !== "undefined") localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }
  function load() {
    if (typeof localStorage === "undefined") return freshState();
    try { return normalizeState(JSON.parse(localStorage.getItem(SAVE_KEY))); } catch (_) { return freshState(); }
  }
  function exportSave(state) { return btoa(unescape(encodeURIComponent(JSON.stringify(state)))); }
  function importSave(text) {
    const raw = JSON.parse(decodeURIComponent(escape(atob(text.trim()))));
    if (!raw || typeof raw !== "object") throw new Error("存档格式无效");
    return normalizeState(raw);
  }

  const API = {
    SAVE_KEY, SAVE_VERSION, CHARACTERS, ENEMIES, STAGES, QUALITIES, AFFIXES, LEGENDARIES, SLOT_NAMES, SLOT_ICONS, TACTICS,
    clamp, xpNeeded, hpMultiplier, atkMultiplier, damage, freshState, normalizeState, rngNext, qualityById,
    generateItem, addItem, itemAffixDetails, characterStats, compareItem, equipItem, salvageItem, savePreset, applyPreset, addExperience, skillCost, upgradeSkill,
    rewardForEnemy, recentStageStats, stableStageFor, recordRun, prepareLegendaryChoice, claimLegendaryChoice, itemDropSource, calculateOffline, save, load, exportSave, importSave
  };

  global.StarwishLogic = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
