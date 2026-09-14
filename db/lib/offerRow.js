// The two buttons on a consent DM (docs/systemdocs/LESSONS.md): Accept and Decline, keyed by the Offer's id. Shared by both Offer kinds — the bot handler reads the kind off the row, not off the button. Constants live here, in db/, so the web action and the bot handler can't drift on the prefix.
const OFFER_ACCEPT_PREFIX = "offer:accept:";
const OFFER_DECLINE_PREFIX = "offer:decline:";

function offerButtonRow(offerId) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, custom_id: `${OFFER_ACCEPT_PREFIX}${offerId}`, label: "Accept" },
        { type: 2, style: 2, custom_id: `${OFFER_DECLINE_PREFIX}${offerId}`, label: "Decline" },
      ],
    },
  ];
}

// The escort ask (db/lib/escort.js) wears the same two prefixes, so the bot's router needs no new branch to find it. What changes is the chrome: green rather than blurple, and "Cancel" rather than "Decline" — being taken along is an invitation, not a refusal.
function escortButtonRow(offerId) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, custom_id: `${OFFER_ACCEPT_PREFIX}${offerId}`, label: "Accept" },
        { type: 2, style: 2, custom_id: `${OFFER_DECLINE_PREFIX}${offerId}`, label: "Cancel" },
      ],
    },
  ];
}

module.exports = { OFFER_ACCEPT_PREFIX, OFFER_DECLINE_PREFIX, offerButtonRow, escortButtonRow };
