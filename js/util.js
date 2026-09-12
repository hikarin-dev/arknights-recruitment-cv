// Recruitment game data and operator portraits are loaded from upstream sources.
const DATA_BASE = {
  en_US: "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/en",
  ja_JP: "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/jp",
  ko_KR: "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/kr",
  zh_CN: "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/cn",
};
const SERVERS = { EN: "en_US", JP: "ja_JP", KR: "ko_KR", CN: "zh_CN" };
const serverString = localStorage.getItem("server") || "en_US";

function uri_avatar(charId) {
  const skinSuffix = charId.includes("_amiya") ? "_2" : "";
  return `https://cdn.jsdelivr.net/gh/akgcc/arkdata@main/assets/torappu/dynamicassets/arts/charavatars/${charId}${skinSuffix}.png`.toLowerCase();
}

const CLASS_MAPPING = {
  WARRIOR: "Guard",
  SUPPORT: "Supporter",
  CASTER: "Caster",
  SNIPER: "Sniper",
  TANK: "Defender",
  PIONEER: "Vanguard",
  SPECIAL: "Specialist",
  MEDIC: "Medic",
};
const RARITY_MAP = {
  TIER_1: 0,
  TIER_2: 1,
  TIER_3: 2,
  TIER_4: 3,
  TIER_5: 4,
  TIER_6: 5,
};
function updateJSON(dest, src, existingOnly = false) {
  for (let key in src) {
    if (typeof dest[key] == "object" && typeof src[key] == "object")
      dest[key] = updateJSON(dest[key], src[key], existingOnly);
    else if (!existingOnly || key in dest) dest[key] = src[key];
  }
  return dest;
}

async function get_char_table(
  keep_non_playable = false,
  server = "en_US",
) {
  let raw = await fetch(
    `${DATA_BASE[server]}/gamedata/excel/character_table.json`,
  );
  let json = await fixedJson(raw);
  raw = await fetch(
    `${DATA_BASE[server]}/gamedata/excel/char_patch_table.json`,
  );
  let patch = await fixedJson(raw);
  updateJSON(json, patch.patchChars);
  Object.keys(json).forEach((op) => {
    json[op].profession =
      CLASS_MAPPING[json[op].profession] || json[op].profession;
    // rename amiya forms to prevent conflict
    if (op.includes("_amiya"))
      json[op].name = `${json[op].name} (${json[op].profession})`;
  });
  for (var key in json) {
    if (!keep_non_playable && !json[key].displayNumber) delete json[key];
    else {
      json[key].charId = key;
      // remap "rarity" field (AK 2.0)
      json[key].rarity = RARITY_MAP[json[key].rarity] ?? json[key].rarity;
    }
  }
  return json;
}

async function fixedJson(res) {
  // if .json() fails, try to remove trailing comma then parse with JSON.parse
  return res
    .clone()
    .json()
    .catch((e) =>
      res.text().then((txt) => JSON.parse(txt.replace(/,(\W+}\W*$)/, "$1"))),
    );
}

function getCssStyle(element, prop) {
  return window.getComputedStyle(element, null).getPropertyValue(prop);
}

function getCanvasFontSize(el = document.body) {
  const fontWeight = getCssStyle(el, "font-weight") || "normal";
  const fontSize = getCssStyle(el, "font-size") || "12px";
  const fontFamily = getCssStyle(el, "font-family") || "Ariel";

  return fontWeight + " " + fontSize + " " + fontFamily;
}

function getTextWidth(text, font) {
  // re-use canvas object for better performance
  const canvas =
    getTextWidth.canvas ||
    (getTextWidth.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  context.font = font;
  const metrics = context.measureText(text);
  return metrics.width;
}

function divideString(text) {
  let tokens = text.split(" ");
  if (tokens.length < 2) return [text, ""];
  let diff = text.length;
  let i = 1;
  for (; i < tokens.length; i++) {
    let newdiff = Math.abs(
      tokens.slice(0, i).join(" ").length - tokens.slice(i).join(" ").length,
    );
    if (newdiff > diff) break;
    diff = newdiff;
  }
  return [tokens.slice(0, i - 1).join(" "), tokens.slice(i - 1).join(" ")];
}

function CreateOpCheckbox(operator, destDiv) {
  let operatorName = operator.name;
  var checkboxDiv = document.createElement("div");
  checkboxDiv.classList.add("operatorCheckbox", "show");
  checkboxDiv.dataset.class = operator.profession;
  checkboxDiv.dataset.rarity = operator.rarity;
  let im = document.createElement("img");
  im.setAttribute("loading", "lazy");
  im.src = uri_avatar(operator.charId);
  checkboxDiv.appendChild(im);

  let name = document.createElement("div");
  name.classList.add("name");
  let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  let txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
  txt.innerHTML = operatorName;
  txt.setAttribute("x", "50%");
  txt.setAttribute("y", "50%");
  txt.setAttribute("dominant-baseline", "central");
  txt.setAttribute("text-anchor", "middle");
  txt.setAttribute("lengthAdjust", "spacingAndGlyphs");
  svg.appendChild(txt);
  name.appendChild(svg);

  checkboxDiv.appendChild(name);

  destDiv.appendChild(checkboxDiv);

  // must do this after appending to body as we need computed styles.
  let nameWidth = getTextWidth(operatorName, getCanvasFontSize(name));
  let plateWidth = parseInt(getComputedStyle(checkboxDiv).width);
  if (nameWidth > plateWidth * 1.2 && operatorName.split(" ").length > 1) {
    // multiple words, split onto multiple lines.
    let [first, second] = divideString(operatorName);
    txt.setAttribute("y", "35%");
    txt.setAttribute("x", "0");
    txt.setAttribute("transform", "scale(1,.75)");
    txt.innerHTML = "";
    // need to check width of each line and set textLength
    let firstLine = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "tspan",
    );
    firstLine.setAttribute("dy", "0");
    firstLine.setAttribute("x", "50%");
    if (getTextWidth(first, getCanvasFontSize(name)) > plateWidth * 0.95)
      firstLine.setAttribute("textLength", plateWidth * 0.95);
    firstLine.innerHTML = first;
    let secondLine = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "tspan",
    );
    secondLine.setAttribute("dy", "1em");
    secondLine.setAttribute("x", "50%");
    if (getTextWidth(second, getCanvasFontSize(name)) > plateWidth * 0.95)
      secondLine.setAttribute("textLength", plateWidth * 0.95);
    secondLine.innerHTML = second;
    txt.appendChild(firstLine);
    txt.appendChild(secondLine);
  } else if (nameWidth > plateWidth * 0.95)
    txt.setAttribute("textLength", plateWidth * 0.95);

  return checkboxDiv;
}
window.onload = () => {
  const title = document.getElementById("pageTitle");
  if (title) title.href = location.origin + location.pathname;

  const serverSelect = document.getElementById("serverSelect");
  if (serverSelect) {
    const dd_content = serverSelect.querySelector(".dropdown-content");
    const dd_btn = serverSelect.querySelector(".dropbtn");
    Object.keys(SERVERS).forEach((k) => {
      let opt = document.createElement("div");
      opt.dataset.value = SERVERS[k];
      opt.innerHTML = k;
      opt.onclick = () => {
        localStorage.setItem("server", SERVERS[k]);
        location.reload();
      };
      dd_content.appendChild(opt);
      if ((localStorage.getItem("server") || "en_US") == SERVERS[k])
        dd_btn.firstChild.nodeValue = k;
    });
    // click handlers for mobile
    dd_btn.onclick = () => {
      dd_content.classList.toggle("show");
      dd_btn.classList.toggle("checked");
    };
    window.addEventListener("click", (e) => {
      if (e.target != dd_btn) {
        dd_content.classList.remove("show");
        dd_btn.classList.remove("checked");
      }
    });
  }
};
