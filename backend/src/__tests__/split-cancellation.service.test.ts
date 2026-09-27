import { beforeEach, describe, expect, it, vi } from "vitest";

const findOneMock = vi.fn();
const saveMock = vi.fn();
const createMock = vi.fn((input: unknown) => input);
const findMock = vi.fn();
const upsertMock = vi.fn();

vi.mock("../services/database.js", () => ({
  getDataSource: () => ({
    getRepository: () => ({
      findOne: findOneMock,
      save: saveMock,
      create: createMock,
      find: findMock,
      upsert: upsertMock,
    }),
  }),
}));

const {
  cancelSplit,
  getCancellation,
  assertFundingAllowed,
  AlreadyCancelledError,
  NotCancellableError,
} = await import("../services/split-cancellation.service.js");

const {
  getPreferences,
  updatePreferences,
  shouldDeliver,
  MandatoryCategoryError,
} = await import("../services/notification-preferences.service.js");

function project(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "p1",
    locked: false,
    balance: "100",
    totalDistributed: "0",
    distributionRound: 0,
    collaborators: [],
    ...overrides,
  } as Parameters<typeof cancelSplit>[0]["project"];
}

beforeEach(() => {
  vi.clearAllMocks();
  findMock.mockResolvedValue([]);
});

describe("cancelSplit", () => {
  it("cancels an active split", async () => {
    findOneMock.mockResolvedValue(null);
    saveMock.mockImplementation(async (r: unknown) => r);

    const result = await cancelSplit({
      project: project(),
      cancelledBy: "GOWNER",
      reason: "no longer needed",
    });

    expect(result.projectId).toBe("p1");
    expect(result.cancelledBy).toBe("GOWNER");
    expect(result.reason).toBe("no longer needed");
  });

  it("refuses to cancel a split that is already distributing", async () => {
    findOneMock.mockResolvedValue(null);
    await expect(
      cancelSplit({
        project: project({ locked: true, balance: "100" }),
        cancelledBy: "GOWNER",
      }),
    ).rejects.toBeInstanceOf(NotCancellableError);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("refuses to cancel a settled split rather than rewriting history", async () => {
    findOneMock.mockResolvedValue(null);
    await expect(
      cancelSplit({
        project: project({ locked: true, balance: "0", totalDistributed: "500" }),
        cancelledBy: "GOWNER",
      }),
    ).rejects.toBeInstanceOf(NotCancellableError);
  });

  it("reports an already-cancelled split instead of duplicating", async () => {
    findOneMock.mockResolvedValue({ projectId: "p1" });
    await expect(
      cancelSplit({ project: project(), cancelledBy: "GOWNER" }),
    ).rejects.toBeInstanceOf(AlreadyCancelledError);
  });

  it("treats a concurrent cancellation as already-cancelled, not a crash", async () => {
    findOneMock.mockResolvedValue(null);
    saveMock.mockRejectedValue(
      Object.assign(new Error("duplicate key"), { code: "23505" }),
    );
    await expect(
      cancelSplit({ project: project(), cancelledBy: "GOWNER" }),
    ).rejects.toBeInstanceOf(AlreadyCancelledError);
  });

  it("rethrows unrelated database errors", async () => {
    findOneMock.mockResolvedValue(null);
    saveMock.mockRejectedValue(
      Object.assign(new Error("connection lost"), { code: "08006" }),
    );
    await expect(
      cancelSplit({ project: project(), cancelledBy: "GOWNER" }),
    ).rejects.toThrow("connection lost");
  });

  it("normalises an empty reason to null", async () => {
    findOneMock.mockResolvedValue(null);
    saveMock.mockImplementation(async (r: unknown) => r);
    const result = await cancelSplit({
      project: project(),
      cancelledBy: "GOWNER",
      reason: "   ",
    });
    expect(result.reason).toBeNull();
  });
});

describe("assertFundingAllowed", () => {
  it("allows funding when the split is not cancelled", async () => {
    findOneMock.mockResolvedValue(null);
    await expect(assertFundingAllowed("p1")).resolves.toBeUndefined();
  });

  it("blocks funding once cancelled", async () => {
    findOneMock.mockResolvedValue({
      projectId: "p1",
      cancelledAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await expect(assertFundingAllowed("p1")).rejects.toThrow(/cancelled/i);
  });
});

describe("getCancellation", () => {
  it("returns null when none exists", async () => {
    findOneMock.mockResolvedValue(null);
    expect(await getCancellation("p1")).toBeNull();
  });
});

describe("notification preferences", () => {
  it("defaults every category to enabled when nothing is stored", async () => {
    findMock.mockResolvedValue([]);
    const prefs = await getPreferences("GABC");
    expect(prefs.every((p) => p.enabled)).toBe(true);
  });

  it("treats a missing row as default rather than opted out", async () => {
    // A category added later must not arrive silently muted for users who
    // already saved preferences for the others.
    findMock.mockResolvedValue([
      { wallet: "GABC", category: "marketing", enabled: false },
    ]);
    const prefs = await getPreferences("GABC");
    expect(prefs.find((p) => p.category === "marketing")?.enabled).toBe(false);
    expect(prefs.find((p) => p.category === "project_activity")?.enabled).toBe(true);
  });

  it("reports mandatory categories as enabled even if a stale row disables them", async () => {
    findMock.mockResolvedValue([
      { wallet: "GABC", category: "security", enabled: false },
      { wallet: "GABC", category: "payment", enabled: false },
    ]);
    const prefs = await getPreferences("GABC");
    expect(prefs.find((p) => p.category === "security")?.enabled).toBe(true);
    expect(prefs.find((p) => p.category === "payment")?.enabled).toBe(true);
  });

  it("flags which categories are mandatory", async () => {
    findMock.mockResolvedValue([]);
    const prefs = await getPreferences("GABC");
    expect(prefs.find((p) => p.category === "security")?.mandatory).toBe(true);
    expect(prefs.find((p) => p.category === "marketing")?.mandatory).toBe(false);
  });

  it("refuses to disable a mandatory category instead of ignoring it", async () => {
    await expect(
      updatePreferences("GABC", [{ category: "security", enabled: false }]),
    ).rejects.toBeInstanceOf(MandatoryCategoryError);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects the whole update if any entry is disallowed", async () => {
    // Partially applying would leave the client's view and the stored state
    // disagreeing about what was saved.
    await expect(
      updatePreferences("GABC", [
        { category: "marketing", enabled: false },
        { category: "payment", enabled: false },
      ]),
    ).rejects.toBeInstanceOf(MandatoryCategoryError);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("allows enabling a mandatory category (a no-op, but not an error)", async () => {
    findMock.mockResolvedValue([]);
    await expect(
      updatePreferences("GABC", [{ category: "security", enabled: true }]),
    ).resolves.toBeDefined();
  });

  it("persists an opt-out for an optional category", async () => {
    findMock.mockResolvedValue([]);
    await updatePreferences("GABC", [{ category: "marketing", enabled: false }]);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: "marketing", enabled: false }),
      ["wallet", "category"],
    );
  });

  it("always delivers mandatory categories without consulting storage", async () => {
    expect(await shouldDeliver("GABC", "security")).toBe(true);
    expect(await shouldDeliver("GABC", "payment")).toBe(true);
    expect(findMock).not.toHaveBeenCalled();
  });

  it("respects an opt-out for an optional category", async () => {
    findMock.mockResolvedValue([
      { wallet: "GABC", category: "marketing", enabled: false },
    ]);
    expect(await shouldDeliver("GABC", "marketing")).toBe(false);
  });
});
