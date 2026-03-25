// intent.js
// Detects what kind of request the customer is making
// and whether the bot should escalate to a human agent

const INTENT_PATTERNS = {
  escalate: /billing|overcharg|damaged|defective|broken|legal|complaint|refund denied|angry|frustrated|speak to (a )?human|real person|manager|supervisor|corporate order|bulk order/i,
  order:    /order|track|package|delivery|dispatch|parcel|shipped|where.*my|status/i,
  returns:  /return|refund|exchange|bring back|unused/i,
  product:  /product|price|cost|stock|available|kitchenware|bedding|decor|what do you sell/i,
  hours:    /hour|open|close|when.*open|operating|weekend|sunday|holiday/i,
  payment:  /pay|mpesa|visa|card|cash|till number|how.*pay/i,
  loyalty:  /loyalty|reward|point|redeem|discount|offer|promo/i,
};

/**
 * Returns the intent string for a given user message.
 * Priority: escalate > order > returns > product > hours > payment > loyalty > faq
 */
function detectIntent(text) {
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (pattern.test(text)) return intent;
  }
  return 'faq';
}

/**
 * Checks if the bot's reply contains an escalation phrase.
 * This is used to flag the turn in the database.
 */
function detectEscalation(replyText) {
  return /connect you with|human support agent|human agent|please hold/i.test(replyText);
}

/**
 * Returns context-aware quick reply suggestions based on intent.
 */
function suggestQuickReplies(intent) {
  const map = {
    faq:      ['Store hours?', 'Where are you located?', 'How do I contact support?'],
    order:    ['Track my order', 'How long is delivery?', 'Change delivery address'],
    returns:  ['How do I return an item?', 'Return policy?', 'Request a refund'],
    product:  ['What products do you sell?', 'Is this item in stock?', 'Current promotions?'],
    hours:    ['Are you open on Sundays?', 'Public holiday hours?', 'What time do you close?'],
    payment:  ['M-Pesa till number?', 'Do you accept cards?', 'Cash on delivery?'],
    loyalty:  ['How do I earn points?', 'How do I redeem points?', 'Check my points balance'],
    escalate: ['Speak to a human', 'Submit a complaint', 'Request a callback'],
  };
  return map[intent] || map.faq;
}

module.exports = { detectIntent, detectEscalation, suggestQuickReplies };