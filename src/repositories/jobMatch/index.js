const { JobMatch } = require("../../models/jobMatchModel");

exports.upsertJobMatch = async (payload) => {
  const { userId, jobId, query, location } = payload;
  return JobMatch.findOneAndUpdate(
    { userId, jobId, query, location },
    { $set: payload },
    { new: true, upsert: true }
  );
};

exports.findJobMatches = async ({ userId, query, location, limit = 10 }) => {
  return JobMatch.find({ userId, query, location })
    .sort({ lastSeenAt: -1 })
    .limit(limit);
};

exports.enforceJobMatchCap = async ({ userId, query, location, cap = 10 }) => {
  const matches = await JobMatch.find({ userId, query, location })
    .sort({ lastSeenAt: -1 })
    .select("_id")
    .skip(cap);
  if (!matches.length) return;
  const ids = matches.map((m) => m._id);
  await JobMatch.deleteMany({ _id: { $in: ids } });
};
