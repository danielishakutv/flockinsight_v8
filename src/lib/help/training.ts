import type { Guide } from "./types";

export const TRAINING_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "training",
    title: "Training, classes & badges",
    category: "training",
    icon: "training",
    summary:
      "Run Foundation, Baptism, Pre-Marital and leadership training — and show at a glance who has completed what.",
    whoFor: [
      "Pastors running membership or leadership classes",
      "Class secretaries who keep the register",
      "Anyone who has ever asked 'has this person done Foundation?'",
    ],
    sections: [
      {
        title: "Courses and classes — the one thing to understand",
        blocks: [
          {
            kind: "text",
            text: "There are two levels, and getting them the right way round makes everything else obvious.",
          },
          {
            kind: "table",
            headers: ["", "What it is", "Example"],
            rows: [
              [
                "Course",
                "The teaching itself. Set up once, kept forever.",
                "Foundation Class",
              ],
              [
                "Class",
                "One running of that course, with its own dates and register.",
                "Foundation Class — January 2026",
              ],
            ],
          },
          {
            kind: "text",
            text: "You create Foundation Class once. You then run it in January, in May and again in September — three classes, one course. People enrol in a class, never in the course.",
          },
          {
            kind: "note",
            text: "This is why someone who took Foundation in 2024 and someone who took it last month both show the same badge. They completed the same course, in different classes.",
          },
        ],
      },
      {
        title: "Set up a course",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Training → New course",
                detail: "Name it the way your church says it: 'Foundation Class', 'Workers in Training', 'Pre-Marital Counselling'.",
              },
              {
                title: "Pick the type",
                detail:
                  "Class for the congregation (Foundation, Baptism, Pre-Marital). Training for workers (leaders, pastors, teachers). Course for anything else. It only affects how things are labelled and filtered.",
              },
              {
                title: "Set the level",
                detail:
                  "A number showing progression. Foundation might be 1, Workers in Training 2, Leadership 3. A member's standing is their highest completed level, so this is what ranks people.",
              },
              {
                title: "Design the badge",
                detail:
                  "A short label, an icon and a colour. The preview shows exactly how it will look beside somebody's name before you save. Keep the label short — 'FND' reads better in a list of 300 people than 'Foundation Class'.",
              },
              {
                title: "Set a pass mark, if it is examined",
                detail:
                  "Leave it blank for a class where attending is passing. Set it (say 50) if there is a test, and anyone scoring below it is marked as not passed.",
              },
            ],
          },
        ],
      },
      {
        title: "Run a class",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Open the course, then New class",
                detail:
                  "Name it for when it runs. Add start and end dates, the venue, the meeting day and time, and a capacity if space is limited.",
              },
              {
                title: "Add your instructors",
                detail:
                  "Pick a member, or just type a name for a visiting minister who is not in your directory. Give each a role — Instructor, Facilitator, Assistant.",
              },
              {
                title: "Enrol people",
                detail:
                  "Tick as many as you like from your congregation at once. Anyone already on the register is not offered again, so you cannot double-enrol by accident.",
              },
              {
                title: "Keep the status honest as it runs",
                detail:
                  "Enrolled → In progress → Completed. Someone who stops coming is Withdrawn; someone who sat the test and did not pass is Did not pass. Both are kept, because a class that never records a failure is not recording anything.",
              },
              {
                title: "Finish the class",
                detail:
                  "Use Mark all complete. Everyone still taking it is completed and dated in one action. Anyone withdrawn or failed is deliberately left exactly as they are.",
              },
            ],
          },
          {
            kind: "warning",
            text: "Deleting a class that has completed students is refused on purpose — it would take their badges with it. Set the class to Completed or Cancelled instead. The same applies to a course with any enrolment against it: mark it inactive rather than deleting.",
          },
        ],
      },
      {
        title: "Scores, grades and ranking",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Record beside anyone on the register opens their result: a score out of 100, a grade in your own words ('A', 'Distinction', 'Pass'), a certificate number, and notes.",
              "Marking someone Completed fills in today's date automatically if you don't give one.",
              "Once scores exist, the top three positions in that class are marked. Two people on the same score share a position — there is no arbitrary tie-break.",
              "If the course has a pass mark, anyone below it is shown in red so it is obvious at a glance.",
            ],
          },
        ],
      },
      {
        title: "Badges beside names",
        blocks: [
          {
            kind: "text",
            text: "This is what most churches actually want it for. Completing a course puts a small coloured chip beside that person's name, so you can see who is qualified without opening anything.",
          },
          {
            kind: "bullets",
            items: [
              "It appears in the Members list and on the member's own profile.",
              "Up to two badges show in a list, with '+2' for the rest so long names stay readable. Hovering shows the full course name.",
              "The member's profile lists everything they have ever taken, with the class, the result and the date.",
              "A course can be set not to show a badge at all, for internal training you don't want advertised.",
            ],
          },
          {
            kind: "example",
            title: "Grace Chapel, Ikeja",
            lines: [
              "Foundation Class — level 1, badge 'FND', green. Attendance is enough to pass, so no pass mark.",
              "Baptism Class — level 1, badge 'BAP', blue, with a water-drop icon.",
              "Workers in Training — level 2, badge 'WIT', amber, pass mark 50, issues a certificate.",
              "Leadership School — level 3, badge 'LEAD', purple with a crown, pass mark 60.",
              "When the pastor opens the Members list to pick new ushers, he can see immediately which people carry FND and WIT — no cross-checking a notebook.",
            ],
          },
        ],
      },
      {
        title: "What is not built yet",
        blocks: [
          {
            kind: "text",
            text: "Being straight with you about the edges, so you don't go looking for something that isn't there:",
          },
          {
            kind: "bullets",
            items: [
              "There is no register for each individual class meeting yet — you record the final outcome, not who came on week three.",
              "There are no quizzes or tests inside the app. You set them however you already do, and type the score in.",
              "Certificates are not generated as printable documents yet. You can record the certificate number against each person.",
            ],
          },
          {
            kind: "note",
            text: "All three are on the roadmap and the system was designed to take them without any of your existing records changing.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Somebody took Foundation twice. Do they get two badges?",
        a: "No. One course is one badge, however many times they sat it.",
      },
      {
        q: "Can an instructor also be a student in the same class?",
        a: "Yes. Instructors are chosen from your whole congregation, including people on that register.",
      },
      {
        q: "How do I record classes people finished years ago, before we used this?",
        a: "Create the course, create a class named for the year it ran, enrol everyone who did it, and use Mark all complete. Then correct the completion date on the register if you want it accurate.",
      },
      {
        q: "Who can change training records?",
        a: "Anyone with the Training → Manage permission. You can give a class secretary Training only, and nothing else — Settings → Roles.",
      },
      {
        q: "What happens to someone's badges if I delete them from a class?",
        a: "Removing a person from a register removes that completion, and the badge with it. Withdrawing them is usually what you mean instead.",
      },
    ],
    links: [
      { label: "Training", href: "/training" },
      { label: "Members", href: "/members" },
      { label: "Roles", href: "/settings/roles" },
    ],
    tip: "Set your levels deliberately the first time. Level is what decides a member's standing, and changing it later reshuffles how everyone ranks.",
    related: ["members", "groups", "team-roles"],
    keywords: [
      "training",
      "class",
      "foundation",
      "baptism",
      "premarital",
      "pre-marital",
      "discipleship",
      "leadership",
      "course",
      "badge",
      "certificate",
      "graduation",
    ],
  },
];
