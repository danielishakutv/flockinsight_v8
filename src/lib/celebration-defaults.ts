/** Defaults used when a church has no celebration_setting row yet. */
export const CELEBRATION_DEFAULTS = {
  enabled: false,
  sms: false,
  email: true,
  sendTime: "08:00",
  birthdaySms:
    "Happy birthday, {name}! 🎉 Everyone at {church} celebrates you today. Have a blessed year!",
  birthdayEmailSubject: "Happy Birthday, {name}! 🎉",
  birthdayEmailBody:
    "Dear {name},\n\nHappy birthday! On behalf of the entire {church} family, we celebrate the gift of your life today. May this new year be filled with God's blessings, joy and good health.\n\nWe love and appreciate you!",
  anniversarySms:
    "Happy {occasion}, {name}! 🎊 {church} celebrates with you today. God bless you!",
  anniversaryEmailSubject: "Happy {occasion}, {name}!",
  anniversaryEmailBody:
    "Dear {name},\n\nCongratulations on your {occasion}! The {church} family rejoices with you and prays God's continued blessing over you.\n\nWith love,\n{church}",
};
