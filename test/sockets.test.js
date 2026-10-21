import { jest } from "@jest/globals";

const service = {
  createPoll: jest.fn(),
  voteInPoll: jest.fn(),
  closePoll: jest.fn(),
};

jest.unstable_mockModule("../src/services/space-poll.service.js", () => ({
  default: service,
}));
jest.unstable_mockModule("../src/config/logger.js", () => ({
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const { initSpacePollSocket } = await import("../src/sockets/space-poll.socket.js");
const { initUserPreferencesSocket, emitPreferenceUpdate } = await import(
  "../src/sockets/preferences.socket.js"
);

// Fake io whose namespace records handlers and room emits.
const makeIo = () => {
  const roomEmit = jest.fn();
  const ns = {
    handlers: {},
    on: jest.fn((evt, fn) => {
      ns.handlers[evt] = fn;
    }),
    to: jest.fn(() => ({ emit: roomEmit })),
  };
  const io = { of: jest.fn(() => ns) };
  return { io, ns, roomEmit };
};

const makeSocket = () => {
  const socket = {
    id: "sock-1",
    handlers: {},
    on: jest.fn((evt, fn) => {
      socket.handlers[evt] = fn;
    }),
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
  };
  return socket;
};

const connect = (ns, socket) => ns.handlers.connection(socket);

beforeEach(() => jest.clearAllMocks());

describe("space-poll socket", () => {
  let ns, roomEmit, socket;
  beforeEach(() => {
    const made = makeIo();
    ns = made.ns;
    roomEmit = made.roomEmit;
    expect(initSpacePollSocket(made.io)).toBe(ns);
    expect(made.io.of).toHaveBeenCalledWith("/space-polls");
    socket = makeSocket();
    connect(ns, socket);
  });

  it("joins and leaves the space poll room", () => {
    socket.handlers.join_space_poll_room("s1");
    expect(socket.join).toHaveBeenCalledWith("space_poll_s1");
    socket.handlers.leave_space_poll_room("s1");
    expect(socket.leave).toHaveBeenCalledWith("space_poll_s1");
  });

  it("create_poll broadcasts poll_created to the space room", async () => {
    const poll = { _id: "p1", space: "s1" };
    service.createPoll.mockResolvedValue(poll);
    const data = { spaceId: "s1", hostId: "h", question: "q", options: ["a", "b"] };
    await socket.handlers.create_poll(data);
    expect(service.createPoll).toHaveBeenCalledWith(data);
    expect(ns.to).toHaveBeenCalledWith("space_poll_s1");
    expect(roomEmit).toHaveBeenCalledWith("poll_created", poll);
  });

  it("create_poll emits poll_error to the sender only on failure", async () => {
    service.createPoll.mockRejectedValue(new Error("Space not found"));
    await socket.handlers.create_poll({ spaceId: "x" });
    expect(socket.emit).toHaveBeenCalledWith("poll_error", { message: "Space not found" });
    expect(roomEmit).not.toHaveBeenCalled();
  });

  it("cast_vote broadcasts poll_results_updated to the poll's space room", async () => {
    const poll = { _id: "p1", space: "s9" };
    service.voteInPoll.mockResolvedValue(poll);
    const data = { pollId: "p1", userId: "u", optionIndex: 0 };
    await socket.handlers.cast_vote(data);
    expect(service.voteInPoll).toHaveBeenCalledWith(data);
    expect(ns.to).toHaveBeenCalledWith("space_poll_s9");
    expect(roomEmit).toHaveBeenCalledWith("poll_results_updated", poll);
  });

  it("cast_vote reports errors such as a closed poll", async () => {
    service.voteInPoll.mockRejectedValue(new Error("Poll is closed for voting"));
    await socket.handlers.cast_vote({ pollId: "p1" });
    expect(socket.emit).toHaveBeenCalledWith("poll_error", {
      message: "Poll is closed for voting",
    });
    expect(roomEmit).not.toHaveBeenCalled();
  });

  it("close_poll broadcasts poll_closed, and reports errors", async () => {
    const poll = { _id: "p1", space: "s1" };
    service.closePoll.mockResolvedValueOnce(poll);
    await socket.handlers.close_poll({ pollId: "p1", hostId: "h" });
    expect(roomEmit).toHaveBeenCalledWith("poll_closed", poll);

    service.closePoll.mockRejectedValueOnce(new Error("Poll not found"));
    await socket.handlers.close_poll({ pollId: "nope" });
    expect(socket.emit).toHaveBeenCalledWith("poll_error", { message: "Poll not found" });
  });
});

describe("preferences socket", () => {
  let ns, socket, io;
  beforeEach(() => {
    const made = makeIo();
    io = made.io;
    ns = made.ns;
    expect(initUserPreferencesSocket(io)).toBe(ns);
    expect(io.of).toHaveBeenCalledWith("/preferences");
    socket = makeSocket();
    connect(ns, socket);
  });

  it("joins and leaves the user's preferences room", () => {
    socket.handlers.join_preferences_room("u1");
    expect(socket.join).toHaveBeenCalledWith("user_preferences_u1");
    socket.handlers.leave_preferences_room("u1");
    expect(socket.leave).toHaveBeenCalledWith("user_preferences_u1");
  });

  it("ignores join/leave with a falsy userId", () => {
    socket.handlers.join_preferences_room(undefined);
    socket.handlers.leave_preferences_room("");
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.leave).not.toHaveBeenCalled();
  });

  it("emitPreferenceUpdate emits preference_updated with payload to the user's room", () => {
    const prefs = { theme: "dark" };
    expect(emitPreferenceUpdate("u1", prefs)).toBe(true);
    expect(ns.to).toHaveBeenCalledWith("user_preferences_u1");
    const emit = ns.to.mock.results[0].value.emit;
    const [evt, payload] = emit.mock.calls[0];
    expect(evt).toBe("preference_updated");
    expect(payload).toMatchObject({ userId: "u1", preferences: prefs });
    expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
  });

  it("emitPreferenceUpdate returns false without userId", () => {
    expect(emitPreferenceUpdate(null, {})).toBe(false);
    expect(ns.to).not.toHaveBeenCalled();
  });

  it("emitPreferenceUpdate returns false when emitting throws", () => {
    ns.to.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(emitPreferenceUpdate("u1", {})).toBe(false);
  });
});
