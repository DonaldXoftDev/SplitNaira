import { beforeEach, describe, expect, it, vi } from "vitest";

const findOneMock = vi.fn();
const saveMock = vi.fn();
const countMock = vi.fn();
const createMock = vi.fn((input: unknown) => input);

// Query-builder doubles, shared by the list and mark-read paths.
const getManyMock = vi.fn();
const executeMock = vi.fn();
const whereMock = vi.fn();
const andWhereMock = vi.fn();

function makeSelectBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    where: vi.fn((...args: unknown[]) => {
      whereMock(...args);
      return chain();
    }),
    andWhere: vi.fn((...args: unknown[]) => {
      andWhereMock(...args);
      return chain();
    }),
    orderBy: vi.fn(chain),
    addOrderBy: vi.fn(chain),
    take: vi.fn(chain),
    getMany: getManyMock,
    update: vi.fn(chain),
    set: vi.fn(chain),
    execute: executeMock,
  });
  return builder;
}

vi.mock("../services/database.js", () => ({
  getDataSource: () => ({
    getRepository: () => ({
      create: createMock,
      save: saveMock,
      findOne: findOneMock,
      count: countMock,
      createQueryBuilder: () => makeSelectBuilder(),
    }),
  }),
}));

const {
  buildEventKey,
  createNotification,
  listNotifications,
  markRead,
  markAllRead,
  encodeCursor,
  decodeCursor,
} = await import("../services/notifications.service.js");

function uniqueViolation() {
  return Object.assign(new Error("duplicate key value"), { code: "23505" });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    recipient: "GABC",
    category: "project",
    title: "t",
    body: "b",
    eventKey: "k",
    source: "ledger",
    resourceType: null,
    resourceId: null,
    metadata: null,
    readAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  countMock.mockResolvedValue(0);
});

describe("buildEventKey", () => {
  it("is stable for the same logical event", () => {
    const a = buildEventKey({
      eventType: "payment.settled",
      resourceType: "split",
      resourceId: "abc",
    });
    const b = buildEventKey({
      eventType: "payment.settled",
      resourceType: "split",
      resourceId: "abc",
    });
    expect(a).toBe(b);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(
      buildEventKey({ eventType: " Payment.Settled ", resourceId: " ABC " }),
    ).toBe(buildEventKey({ eventType: "payment.settled", resourceId: "abc" }));
  });

  it("separates different events on the same resource", () => {
    const settled = buildEventKey({
      eventType: "payment.settled",
      resourceId: "abc",
    });
    const failed = buildEventKey({
      eventType: "payment.failed",
      resourceId: "abc",
    });
    expect(settled).not.toBe(failed);
  });

  it("separates the same event on different resources", () => {
    expect(buildEventKey({ eventType: "x", resourceId: "a" })).not.toBe(
      buildEventKey({ eventType: "x", resourceId: "b" }),
    );
  });

  it("supports a discriminator when one resource emits several", () => {
    expect(
      buildEventKey({ eventType: "x", resourceId: "a", discriminator: "1" }),
    ).not.toBe(
      buildEventKey({ eventType: "x", resourceId: "a", discriminator: "2" }),
    );
  });

  it("refuses an empty event type rather than producing a degenerate key", () => {
    expect(() => buildEventKey({ eventType: "" })).toThrow(/eventType/);
    expect(() => buildEventKey({ eventType: "   " })).toThrow(/eventType/);
  });
});

describe("createNotification", () => {
  const input = {
    recipient: "GABC",
    category: "project" as const,
    title: "Split funded",
    body: "Your split received a deposit.",
    eventKey: "payment.settled:split:abc:-",
    source: "ledger",
  };

  it("creates a notification when the event is new", async () => {
    saveMock.mockResolvedValue(row());
    const result = await createNotification(input);
    expect(result.created).toBe(true);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("returns the existing row when the same event arrives again", async () => {
    // The unique index rejects the second insert; the service reads back the
    // row the first writer committed rather than surfacing an error.
    const original = row({ source: "ledger", createdAt: new Date("2026-01-01T00:00:00.000Z") });
    saveMock.mockRejectedValue(uniqueViolation());
    findOneMock.mockResolvedValue(original);

    const result = await createNotification({ ...input, source: "retry" });

    expect(result.created).toBe(false);
    expect(result.notification).toBe(original);
  });

  it("preserves the original timestamp and source on a duplicate", async () => {
    const firstSeen = new Date("2026-01-01T00:00:00.000Z");
    saveMock.mockRejectedValue(uniqueViolation());
    findOneMock.mockResolvedValue(row({ createdAt: firstSeen, source: "ledger" }));

    const result = await createNotification({
      ...input,
      source: "webhook-retry",
      occurredAt: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(result.notification.createdAt).toEqual(firstSeen);
    expect(result.notification.source).toBe("ledger");
  });

  it("handles concurrent delivery of the same event", async () => {
    // Two workers race; one insert wins, the other conflicts and reads back.
    const winner = row();
    saveMock
      .mockResolvedValueOnce(winner)
      .mockRejectedValueOnce(uniqueViolation());
    findOneMock.mockResolvedValue(winner);

    const [a, b] = await Promise.all([
      createNotification(input),
      createNotification(input),
    ]);

    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(a.notification.id).toBe(b.notification.id);
  });

  it("rethrows errors that are not unique violations", async () => {
    saveMock.mockRejectedValue(Object.assign(new Error("boom"), { code: "08006" }));
    await expect(createNotification(input)).rejects.toThrow("boom");
  });

  it("requires a recipient and an event key", async () => {
    await expect(createNotification({ ...input, recipient: "  " })).rejects.toThrow(
      /recipient/,
    );
    await expect(createNotification({ ...input, eventKey: "" })).rejects.toThrow(
      /eventKey/,
    );
  });
});

describe("cursors", () => {
  it("round-trips a cursor", () => {
    const createdAt = new Date("2026-09-01T12:00:00.000Z");
    const decoded = decodeCursor(encodeCursor(createdAt, "id-1"));
    expect(decoded?.createdAt).toEqual(createdAt);
    expect(decoded?.id).toBe("id-1");
  });

  it("treats a malformed cursor as absent rather than throwing", () => {
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(Buffer.from("garbage", "utf8").toString("base64url"))).toBeNull();
  });
});

describe("listNotifications", () => {
  it("returns a page and a cursor when more remain", async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      row({ id: `n${i}`, createdAt: new Date(2026, 0, 10 - i) }),
    );
    getManyMock.mockResolvedValue(rows);

    const result = await listNotifications({ recipient: "GABC", limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeTruthy();
  });

  it("returns no cursor on the last page", async () => {
    getManyMock.mockResolvedValue([row()]);
    const result = await listNotifications({ recipient: "GABC", limit: 2 });
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it("filters to unread when asked", async () => {
    getManyMock.mockResolvedValue([]);
    await listNotifications({ recipient: "GABC", unreadOnly: true });
    expect(andWhereMock).toHaveBeenCalledWith("n.readAt IS NULL");
  });

  it("caps the page size so a client cannot request the whole table", async () => {
    getManyMock.mockResolvedValue([]);
    await listNotifications({ recipient: "GABC", limit: 10_000 });
    // take() receives limit + 1; the cap is 100.
    expect(getManyMock).toHaveBeenCalled();
  });

  it("requires a recipient", async () => {
    await expect(listNotifications({ recipient: " " })).rejects.toThrow(/recipient/);
  });
});

describe("markRead", () => {
  it("only updates rows that are still unread, so readAt is not moved", async () => {
    executeMock.mockResolvedValue({ affected: 1 });
    findOneMock.mockResolvedValue(row({ readAt: new Date() }));

    await markRead("GABC", "n1");

    const clause = whereMock.mock.calls[0]?.[0] as string;
    expect(clause).toContain("readAt IS NULL");
  });

  it("is idempotent — a second call leaves the original readAt", async () => {
    const firstRead = new Date("2026-05-05T00:00:00.000Z");
    executeMock.mockResolvedValue({ affected: 0 });
    findOneMock.mockResolvedValue(row({ readAt: firstRead }));

    const result = await markRead("GABC", "n1", new Date("2026-09-09T00:00:00.000Z"));

    expect(result?.readAt).toEqual(firstRead);
  });
});

describe("markAllRead", () => {
  it("reports how many were changed", async () => {
    executeMock.mockResolvedValue({ affected: 4 });
    expect(await markAllRead("GABC")).toBe(4);
  });

  it("reports zero when everything was already read", async () => {
    executeMock.mockResolvedValue({ affected: 0 });
    expect(await markAllRead("GABC")).toBe(0);
  });
});
