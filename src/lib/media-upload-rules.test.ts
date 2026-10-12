import { describe, expect, it } from "vitest";
import {
  defaultUploadCategory,
  recordingUploadVerdict,
  sermonNeedsLibraryPlan,
  type RecordingFacts,
} from "@/lib/media-upload-rules";

const rec = (over: Partial<RecordingFacts> = {}): RecordingFacts => ({
  churchId: "church-a",
  churchName: "Grace Chapel",
  churchStatus: "active",
  status: "uploading",
  mediaId: null,
  recordedBy: "pastor",
  hostUserId: "host",
  meetingCreatedBy: "creator",
  ...over,
});

describe("a meeting recording goes to the meeting's church", () => {
  it("files it under the recording's church, whatever the browser has open", () => {
    // The pastor has church B active; the recording is church A's.
    const v = recordingUploadVerdict({ rec: rec(), userId: "pastor", standingAllows: false });
    expect(v).toEqual({ ok: true, churchId: "church-a", alreadySaved: false });
  });

  it("lets the recorder, the host and the creator send it with no library permission", () => {
    for (const userId of ["pastor", "host", "creator"]) {
      const v = recordingUploadVerdict({ rec: rec(), userId, standingAllows: false });
      expect(v.ok).toBe(true);
    }
  });

  it("lets staff of THAT church with meetings or media rights send it", () => {
    const v = recordingUploadVerdict({ rec: rec(), userId: "someone", standingAllows: true });
    expect(v.ok).toBe(true);
  });

  it("refuses anybody else, with a reason that is not 'sign in'", () => {
    const v = recordingUploadVerdict({ rec: rec(), userId: "stranger", standingAllows: false });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.status).toBe(403);
      expect(v.code).toBe("forbidden");
      expect(v.error).not.toMatch(/sign in/i);
      expect(v.error).toContain("Grace Chapel");
    }
  });

  it("says plainly when the recording is gone from the server", () => {
    const v = recordingUploadVerdict({ rec: null, userId: "pastor", standingAllows: true });
    expect(v).toMatchObject({ ok: false, status: 404, code: "not-found" });
  });

  it("holds a paused church's recording on the device rather than filing it", () => {
    const v = recordingUploadVerdict({
      rec: rec({ churchStatus: "suspended" }),
      userId: "pastor",
      standingAllows: true,
    });
    expect(v).toMatchObject({ ok: false, status: 403, code: "suspended" });
  });

  it("never files a second copy of a recording already in the library", () => {
    const v = recordingUploadVerdict({
      rec: rec({ status: "ready", mediaId: "m1" }),
      userId: "pastor",
      standingAllows: false,
    });
    expect(v).toEqual({ ok: true, churchId: "church-a", alreadySaved: true });
  });
});

describe("the sermon library is gated on every upload route alike", () => {
  it("asks the plan for a sermon uploaded to the library", () => {
    expect(sermonNeedsLibraryPlan("sermon")).toBe(true);
    expect(sermonNeedsLibraryPlan("sermon", { recordingId: null })).toBe(true);
  });

  it("never refuses the upload of a meeting recording already made", () => {
    expect(sermonNeedsLibraryPlan("sermon", { recordingId: "rec-1" })).toBe(false);
  });

  it("leaves photos and documents alone on every plan", () => {
    expect(sermonNeedsLibraryPlan("photo")).toBe(false);
    expect(sermonNeedsLibraryPlan("file")).toBe(false);
  });

  it("opens the picker on Document below Pro, so the first photo goes through", () => {
    expect(defaultUploadCategory(false)).toBe("file");
    expect(defaultUploadCategory(true)).toBe("sermon");
  });
});
