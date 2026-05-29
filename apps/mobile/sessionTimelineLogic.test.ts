import { shouldAutoFocusSessionTimelineNewActivity } from "./sessions/sessionTimelineLogic";

describe("Session timeline logic", () => {
  it("auto-focuses new Activity when the user is idle or already at the timeline end", () => {
    expect(shouldAutoFocusSessionTimelineNewActivity({ userIdle: false, userAtTimelineEnd: false })).toBe(false);
    expect(shouldAutoFocusSessionTimelineNewActivity({ userIdle: true, userAtTimelineEnd: false })).toBe(true);
    expect(shouldAutoFocusSessionTimelineNewActivity({ userIdle: false, userAtTimelineEnd: true })).toBe(true);
  });
});
