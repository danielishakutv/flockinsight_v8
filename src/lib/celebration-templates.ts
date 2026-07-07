// Preset message templates a church can apply as their default for birthday and
// anniversary auto-messages. Pure data — safe to import from client or server.
// Placeholders: {name} {church} {occasion} {years}

export type CelebrationPreset = {
  id: string;
  name: string;
  emailSubject: string;
  emailBody: string;
  sms: string;
};

export const BIRTHDAY_PRESETS: CelebrationPreset[] = [
  {
    id: "warm",
    name: "Warm & personal",
    emailSubject: "Happy Birthday, {name}! 🎉",
    emailBody:
      "Dear {name},\n\nHappy birthday! On behalf of the entire {church} family, we celebrate the gift of your life today. May this new year be filled with God's blessings, joy and good health.\n\nWe love and appreciate you!",
    sms: "Happy birthday, {name}! 🎉 Everyone at {church} celebrates you today. Have a blessed year!",
  },
  {
    id: "scripture",
    name: "Scripture blessing",
    emailSubject: "A birthday blessing for you, {name} 🎂",
    emailBody:
      "Dear {name},\n\n\"The Lord bless you and keep you; the Lord make his face shine on you and be gracious to you\" (Numbers 6:24-25).\n\nHappy birthday from all of us at {church}! We thank God for you and pray this new year overflows with His goodness.",
    sms: "Happy birthday {name}! 🎂 'The Lord bless you and keep you' (Num 6:24). Celebrating you today — {church}.",
  },
  {
    id: "short",
    name: "Short & sweet",
    emailSubject: "Happy Birthday, {name}!",
    emailBody:
      "Happy birthday, {name}! 🎉\n\nWishing you a joyful, blessed day and a wonderful year ahead.\n\nWith love,\n{church}",
    sms: "Happy birthday, {name}! 🎉 Wishing you a blessed year ahead. — {church}",
  },
  {
    id: "joyful",
    name: "Joyful & celebratory",
    emailSubject: "It's your day, {name}! 🥳",
    emailBody:
      "Dear {name},\n\nToday we celebrate YOU! 🥳🎈 Thank you for being such a blessing to the {church} family. May your birthday be filled with laughter, love and God's endless favour.\n\nHave the best day — you deserve it!",
    sms: "🥳🎈 It's your day, {name}! The whole {church} family is celebrating you. Have a fantastic, blessed birthday!",
  },
];

export const ANNIVERSARY_PRESETS: CelebrationPreset[] = [
  {
    id: "warm",
    name: "Warm & personal",
    emailSubject: "Happy {occasion}, {name}!",
    emailBody:
      "Dear {name},\n\nCongratulations on your {occasion}! The {church} family rejoices with you and prays God's continued blessing over you.\n\nWith love,\n{church}",
    sms: "Happy {occasion}, {name}! 🎊 {church} celebrates with you today. God bless you!",
  },
  {
    id: "scripture",
    name: "Scripture blessing",
    emailSubject: "Celebrating your {occasion}, {name} 🙏",
    emailBody:
      "Dear {name},\n\n\"Every good and perfect gift is from above\" (James 1:17). On your {occasion}, we thank God with you for {years} year(s) of His faithfulness.\n\nMuch love from your {church} family.",
    sms: "Happy {occasion}, {name}! 🙏 {years} year(s) of God's faithfulness. Celebrating with you — {church}.",
  },
  {
    id: "milestone",
    name: "Milestone focus",
    emailSubject: "{years} years — happy {occasion}, {name}! 🎊",
    emailBody:
      "Dear {name},\n\nWhat a milestone — {years} year(s)! Happy {occasion}. We at {church} celebrate God's grace over your journey and pray for many more blessed years to come.\n\nWith love,\n{church}",
    sms: "🎊 {years} years! Happy {occasion}, {name}. {church} celebrates this milestone with you. God bless you!",
  },
  {
    id: "short",
    name: "Short & sweet",
    emailSubject: "Happy {occasion}, {name}!",
    emailBody:
      "Happy {occasion}, {name}! 🎊\n\nCelebrating with you and wishing you God's continued blessings.\n\n{church}",
    sms: "Happy {occasion}, {name}! 🎊 Celebrating with you today. — {church}",
  },
];
