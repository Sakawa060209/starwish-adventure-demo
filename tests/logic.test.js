"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

test("Demo content has four heroes, ten stages, and the configured boss", () => {
  assert.equal(Object.keys(L.CHARACTERS).length, 4);
  assert.equal(L.STAGES.length, 10);
  assert.deepEqual(L.STAGES[0].waves, [["S", "S"], ["S", "S"]]);
  assert.deepEqual(L.STAGES[9].waves[2], ["B"]);
  assert.equal(L.ENEMIES.B.name, "花冠鹿灵");
});

test("damage formula respects defense, crit, and minimum damage", () => {
  assert.equal(L.damage(22, 1, 0, 0, false, 1.5), 22);
  assert.equal(L.damage(22, 1, 100, 0, false, 1.5), 11);
  assert.equal(L.damage(20, 1, 0, 0, true, 1.5), 30);
  assert.equal(L.damage(0, 1, 999, 0, false, 1.5), 1);
});

test("all generated affixes are legal for their equipment slot", () => {
  const state = L.freshState(12345);
  for (let i = 0; i < 1000; i++) {
    const item = L.generateItem(state, 10, { minQuality: "epic" });
    assert.equal(new Set(item.affixes.map(a => a.id)).size, item.affixes.length);
    for (const rolled of item.affixes) {
      const def = L.AFFIXES.find(a => a.id === rolled.id);
      assert.ok(def.slots.includes(item.slot), `${rolled.id} is illegal on ${item.slot}`);
      assert.ok(rolled.value >= def.min && rolled.value <= def.max);
    }
  }
});

test("legendary drops always resolve to their correct class weapon", () => {
  const state = L.freshState(77);
  for (const legend of Object.values(L.LEGENDARIES)) {
    const item = L.generateItem(state, 10, { legendaryId: legend.id });
    assert.equal(item.quality, "legendary");
    assert.equal(item.slot, "weapon");
    assert.equal(item.charId, legend.charId);
    assert.equal(item.legendaryId, legend.id);
  }
});

test("pity counters force epic and legendary quality", () => {
  const epicState = L.freshState(9);
  epicState.pity.epic = 40;
  assert.ok(["epic", "legendary"].includes(L.generateItem(epicState, 5).quality));
  const legendState = L.freshState(10);
  legendState.pity.legendary = 180;
  const item = L.generateItem(legendState, 10);
  assert.equal(item.quality, "legendary");
  assert.equal(item.slot, "weapon");
});

test("weapon restrictions prevent the wrong hero from equipping", () => {
  const state = L.freshState(15);
  const bow = L.generateItem(state, 3, { slot: "weapon", charId: "archer", minQuality: "rare" });
  state.inventory.push(bow);
  const rejected = L.equipItem(state, bow.id, "knight");
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /叶音/);
  assert.equal(L.equipItem(state, bow.id, "archer").ok, true);
});

test("equipment recalculation changes combat stats without changing identity", () => {
  const state = L.freshState(22);
  const before = L.characterStats(state, "mage");
  const weapon = L.generateItem(state, 10, { slot: "weapon", charId: "mage", minQuality: "epic" });
  state.inventory.push(weapon);
  assert.equal(L.equipItem(state, weapon.id, "mage").ok, true);
  const after = L.characterStats(state, "mage");
  assert.ok(after.atk > before.atk);
  assert.equal(L.CHARACTERS.mage.name, "星璃");
});

test("shared XP levels the party and caps at level ten", () => {
  const state = L.freshState(31);
  assert.equal(L.addExperience(state, 30), 1);
  assert.equal(state.level, 2);
  L.addExperience(state, 100000);
  assert.equal(state.level, 10);
  assert.equal(state.xp, 0);
});

test("skill upgrades spend the documented gold and cap at level three", () => {
  const state = L.freshState(41);
  state.gold = 400;
  assert.equal(L.upgradeSkill(state, "knight").ok, true);
  assert.equal(state.gold, 300);
  assert.equal(L.upgradeSkill(state, "knight").ok, true);
  assert.equal(state.gold, 50);
  assert.equal(L.upgradeSkill(state, "knight").ok, false);
});

test("offline settlement is capped, advances lastSeen, and cannot be claimed twice", () => {
  const state = L.freshState(51);
  state.lastSeen = 1_000_000;
  state.lastStableStage = 3;
  const now = state.lastSeen + 12 * 3600 * 1000;
  const reward = L.calculateOffline(state, now);
  assert.ok(reward.seconds <= 8 * 3600);
  assert.ok(reward.gold > 0);
  assert.equal(state.lastSeen, now);
  assert.equal(L.calculateOffline(state, now), null);
});

test("normalization repairs malformed formation and keeps compatible progress", () => {
  const normalized = L.normalizeState({ level: 7, unlockedStage: 5, currentStage: 9, formation: ["mage", "mage"] });
  assert.equal(normalized.level, 7);
  assert.equal(normalized.currentStage, 5);
  assert.equal(new Set(normalized.formation).size, 4);
  assert.equal(normalized.version, L.SAVE_VERSION);
});

test("a successful first clear becomes the safe fallback without ten samples", () => {
  const state = L.freshState(63);
  L.recordRun(state, 8, true, 72);
  assert.equal(state.lastStableStage, 8);
  assert.equal(state.history[8].length, 1);
});

test("v2 migration supplies idle plans, protected affixes, presets, and boss records", () => {
  const state = L.normalizeState({ version: 1, level: 4, settings: { autoCommon: true } });
  assert.equal(state.version, 2);
  assert.equal(state.idlePlan, "progress");
  assert.deepEqual(Object.keys(state.presets).sort(), ["boss", "farm"]);
  assert.ok(state.settings.protectedAffixes.includes("synergy"));
  assert.equal(state.bossRecords.wins, 0);
});

test("protected synergy gear survives auto salvage and exposes comparison data", () => {
  const state = L.freshState(71);
  state.settings.autoMagic = true;
  const item = L.generateItem(state, 7, { minQuality: "magic", slot: "accessory", forceAffixes: ["synergy"] });
  assert.equal(L.addItem(state, item).kept, true);
  const comparison = L.compareItem(state, item, "lancer");
  assert.ok(Number.isFinite(comparison.dpsPct));
  assert.ok(comparison.special.includes("协同"));
  assert.match(L.itemDropSource(item), /关卡/);
});

test("farm and boss presets restore formation, tactic, and equipment without duplicates", () => {
  const state = L.freshState(81);
  state.formation = ["knight", "lancer", "archer", "mage"];
  state.tactic = "guard";
  assert.equal(L.savePreset(state, "boss").ok, true);
  state.formation.reverse();
  state.tactic = "assault";
  assert.equal(L.applyPreset(state, "boss").ok, true);
  assert.equal(state.formation[0], "knight");
  assert.equal(state.tactic, "guard");
  const ids = Object.values(state.equipment).flatMap(slots => Object.values(slots).filter(Boolean).map(item => item.id));
  assert.equal(new Set(ids).size, ids.length);
});
