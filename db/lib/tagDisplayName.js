const MASTERY_STAR = "★";

function tagDisplayName(tag) {
  const name = tag?.name ?? "";
  return tag?.mastery ? `${MASTERY_STAR} ${name}` : name;
}

module.exports = { tagDisplayName };
