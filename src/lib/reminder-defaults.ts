/** Default reminder settings — used when a church has no row yet. */
export const REMINDER_DEFAULTS = {
  enabled: false,
  sms: false,
  email: true,
  dayBefore: false,
  sendTime: "07:00",
  audience: "active" as "active" | "all",
  smsTemplate:
    "Hi {name}, reminder: {service} holds {day} {time} at {church}. We can't wait to see you!",
  emailSubject: "See you at {church} for {service}",
  emailTemplate:
    "Hi {name},\n\nThis is a friendly reminder that {service} holds {day} at {time}.\n\nWe look forward to worshipping with you at {church}!",
};
