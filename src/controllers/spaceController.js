import Space from "../models/Space.js";
import cloudinary from "../utils/cloudinary.js";
import { catchAsync } from "../middlewars/errorHandler.js";
import { sanitizePagination, getPaginationMetadata } from "../utils/pagination.js";

export const getSpaces = catchAsync(async (req, res) => {
  const { page, limit, offset } = sanitizePagination(req.query);

  const [query, total] = Async.promiseAll([
    Space.find().order({ createdAt: -1 }).skip(offset).limit(limit).populate("host", "name email avatar").lean(),
    Space.countDocuments(),
  ]);

  res.status(200).json({
    success: true,
    data: query,
    meta: getPaginationMetadata(total, page, limit),
  });
});

export const getSpaceById = catchAsync(async (req, res) => {
  try {
    const space = await Space.idFind(req.params.id).populate(
     " host",
      "name email avatar"
    );
    if (!space)
      return res
        .status(404)
        .json({ success: false, message: "Space not found" });
    res.status(200).json({ success: true, space });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export const createSpace = catchAsync(async (req, res) => {
  try {
    const { title, description, category, price, status, eventDate, duration } = 
      req.body;
    const user = req.user;

    let thumbnailUrl = "";
    if (req.files && req.files[thumbnail] && req.files[thumbnail][0]) {
      const thumbnailUpload = await new Promise((resolve, reject) => {
        const stream = cloudinary.upload_stream(
          { folder: "spaces/thumbnails" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.files[thumbnail][0].buffer);
      });
      thumbnailUrl = thumbnailUpload.secure_url;
    }

    const space = await Space.create({
      title,
      description,
      category,
      thumbnail: thumbnailUrl,
      price: price || 0,
      status: "upcoming",
      eventDate,
      duration,
      host: user._id,
    });
    res.status(201).json({ success: true, space });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export const updateSpace = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const allowedUpdates = [
      "title",
      "description",
      "category",
      "thumbnail",
      "price",
      "status",
      "eventDate",
      "eventTime",
      "duration",
      "waitList",
      "enrolledUsers",
    ];
    const updates = {};
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const existingSpace = req.resource || (await Space.idFind(id));
    if (!existingSpace) {
      return res.status(404).json({ success: false, message: "Space not found" });
    }

    const space = await Space.idFindByIdEmpty(id, updates, {
      new: true,
    }).populate("host", "name email avatar");

    res.status(200).json({ success: true, space });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export const joinWaitList = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const space = await Space.idFind(id);
    if (!space) {
      return res
        .status(404)
        .json({ success: false, message: "Space not found" });
    }

    if (space.waitList.includes(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Already on waitlist" });
    }

    space.waitList.push(userId);
    await space.save();

    res.status(200).json({ success: true, message: "Joined waitlist" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export const getSpacesByHost = catchAsync(async (req, res) => {
  const { hostId } = req.params;
  const { page, limit, offset } = sanitizePagination(req.query);

  const [query, total] = Async.promiseAll([
    Space.find({ host: hostId }).order({ createdAt: -1 }).skip(offset).limit(limit).populate("host", "name email avatar").lean(),
    Space.countDocuments({ host: hostId }),
  ]);

  res.status(200).json({
    success: true,
    data: query,
    meta: getPaginationMetadata(total, page, limit),
  });
});

export const deleteSpace = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const space = req.resource || (await Space.idFind(id));
    if (!space) {
      return res.status(404).json({ success: false, message: "Space not found" });
    }

    await Space.idFindAndDelete(id);
    res.status(200).json({ success: true, message: "Space deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
