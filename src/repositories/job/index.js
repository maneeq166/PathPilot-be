const { Job } = require("../../models/jobModel");

exports.upsertJob = async (payload) => {
  const { source, sourceId, url } = payload;
  if (url) {
    return Job.findOneAndUpdate(
      { url },
      { $set: payload },
      { new: true, upsert: true }
    );
  }
  if (source && sourceId) {
    return Job.findOneAndUpdate(
      { source, sourceId },
      { $set: payload },
      { new: true, upsert: true }
    );
  }
  return Job.create(payload);
};

exports.insertJobs = async (items) => {
  if (!items || items.length === 0) return [];
  return Job.insertMany(items, { ordered: false });
};

exports.findJobs = async ({
  query,
  location,
  jobType,
  experienceLevel,
  salaryRange,
  source,
  skip = 0,
  limit = 20,
}) => {
  const filter = {};
  if (query) {
    filter.$text = { $search: query };
  }
  if (location) {
    filter.location = new RegExp(location, "i");
  }
  if (jobType) {
    filter.employmentType = new RegExp(jobType, "i");
  }
  if (experienceLevel) {
    filter.experienceLevel = new RegExp(experienceLevel, "i");
  }
  if (salaryRange) {
    filter.salaryRange = new RegExp(salaryRange, "i");
  }
  if (source) {
    filter.source = new RegExp(source, "i");
  }

  const jobs = await Job.find(filter)
    .sort({ postedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await Job.countDocuments(filter);
  return { jobs, total };
};

exports.findJobsByIds = async (ids = []) => {
  if (!ids || ids.length === 0) return [];
  return Job.find({ _id: { $in: ids } });
};
