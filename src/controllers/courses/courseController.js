import Course from "../../models/Course.js";
import cloudinary from "../../../utils/cloudinary.js";
import mongoose from "mongoose"; // ensure this is imported if you added validation

// Helper function to upload buffer
const uploadToCloudinary = (fileBuffer, folder, resourceType = "image") => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(fileBuffer);
  });
};

export const createCourse = async (req, res) => {
  try {
    console.log("Received createCourse request");
    const { title, description, category, price } = req.body;

    let imageUrl = null;
    let videoUrl = null;

    if (req.files?.thumbnail?.[0]) {
      console.log("Uploading thumbnail...");
      const imageBuffer = req.files.thumbnail[0].buffer;
      const imageResult = await uploadToCloudinary(
        imageBuffer,
        "courses",
        "image"
      );
      imageUrl = imageResult.secure_url;
      console.log("Thumbnail uploaded:", imageUrl);
    }

    if (req.files?.video?.[0]) {
      console.log("Uploading video...");
      const videoBuffer = req.files.video[0].buffer;
      const videoResult = await uploadToCloudinary(
        videoBuffer,
        "courses",
        "video"
      );
      videoUrl = videoResult.secure_url;
      console.log("Video uploaded:", videoUrl);
    }

    const course = await Course.create({
      title,
      description,
      category,
      price,
      createdBy: req.user._id,
      thumbnail: imageUrl,
      video: videoUrl,
    });

    console.log("Course created:", course._id);
    res.status(201).json({ success: true, course });
  } catch (error) {
    console.error("Error in createCourse:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 📚 Get all courses
export const getCourses = async (_req, res) => {
  try {
    const courses = await Course.find().populate(
      "createdBy",
      "name email avatar"
    );
    res.status(200).json({ success: true, courses });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 📘 Get a single course
export const getCourseById = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).populate("createdBy");
    if (!course)
      return res
        .status(404)
        .json({ success: false, message: "Course not found" });

    res.status(200).json({ success: true, course });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 📘 Get all courses created by a specific user

export const getCoursesByUser = async (req, res) => {
  console.log("⚡ Reached getCoursesByUser handler");

  try {
    const { createdBy } = req.query;

    if (!createdBy) {
      console.log("❌ Missing user ID");
      return res
        .status(400)
        .json({ success: false, message: "Missing user id" });
    }

    // Extra safety to avoid invalid ObjectId crashes
    if (!mongoose.Types.ObjectId.isValid(createdBy)) {
      console.log("❌ Invalid ObjectId format");
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID format" });
    }

    console.log("✅ Finding courses...");
    const courses = await Course.find({ createdBy }).populate("createdBy");

    if (!courses || courses.length === 0) {
      return res
        .status(200)
        .json({ success: false, message: "No courses found" });
    }
    res.status(200).json({ success: true, courses });
  } catch (error) {
    console.error("❌ Unexpected Error in getCoursesByUser:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 📥 Enroll a user in a course
export const enrollInCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course)
      return res
        .status(404)
        .json({ success: false, message: "Course not found" });

    if (course.enrolledUsers.includes(req.user._id)) {
      return res
        .status(400)
        .json({ success: false, message: "Already enrolled" });
    }

    course.enrolledUsers.push(req.user._id);
    await course.save();

    res
      .status(200)
      .json({ success: true, message: "Enrolled successfully", course });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 📝 Edit/Update a course
export const updateCourse = async (req, res) => {
  try {
    const { title, description, category, price } = req.body;
    const courseId = req.params.id;

    const course = await Course.findById(courseId);
    if (!course)
      return res
        .status(404)
        .json({ success: false, message: "Course not found" });

    // Optional file updates
    if (req.files?.image?.[0]) {
      const uploadedImage = await cloudinary.uploader.upload(
        req.files.image[0].path,
        { folder: "dnb/courses/images" }
      );
      course.image = uploadedImage.secure_url;
    }

    if (req.files?.video?.[0]) {
      const uploadedVideo = await cloudinary.uploader.upload(
        req.files.video[0].path,
        { resource_type: "video", folder: "dnb/courses/videos" }
      );
      course.video = uploadedVideo.secure_url;
    }

    // Update fields
    course.title = title || course.title;
    course.description = description || course.description;
    course.category = category || course.category;
    course.price = price || course.price;

    await course.save();

    res.status(200).json({ success: true, message: "Course updated", course });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const addCourseReview = async (req, res) => {
  const { rating, comment } = req.body;
  const course = await Course.findById(req.params.id);

  if (!course) {
    return res
      .status(404)
      .json({ success: false, message: "course not found" });
  }

  // Optional: Prevent duplicate reviews by the same user
  const alreadyReviewed = course.reviews.find(
    (r) => r.user.toString() === req.user._id.toString()
  );
  if (alreadyReviewed) {
    return res
      .status(400)
      .json({
        success: false,
        message: "course already reviewed by this user",
      });
  }

  const review = {
    user: req.user._id,
    comment,
    rating: Number(rating),
  };

  course.reviews.push(review);

  // Optionally update average rating and review count
  course.rating =
    course.reviews.reduce((acc, item) => item.rating + acc, 0) /
    course.reviews.length;

  await course.save();
  res
    .status(201)
    .json({ success: true, message: "Review added", reviews: course.reviews });
};

// recommended courses for user based on their profile interest
export const fetchRecommendedCourses = async (req, res) => {
  try {
    const { interests } = req.body;
    const recommended = await Course.find({ category: { $in: interests } });
    res.status(200).json({ success: true, recommended });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
