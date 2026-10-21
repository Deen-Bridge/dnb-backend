import courseBundleService from "../services/course-bundle.service.js";

export const createBundle = async (req, res) => {
  try {
    const { title, description, courses, price, currency } = req.body;
    const createdBy = req.user._id;

    if (!title || !description || !courses || price === undefined) {
      return res.status(400).json({
        success: false,
        message: "Title, description, courses array, and price are required",
      });
    }

    const bundle = await courseBundleService.createBundle({
      title,
      description,
      courses,
      price: Number(price),
      currency,
      createdBy,
    });

    res.status(201).json({
      success: true,
      data: bundle,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getBundles = async (req, res) => {
  try {
    const bundles = await courseBundleService.getBundles(req.query);
    res.status(200).json({
      success: true,
      count: bundles.length,
      data: bundles,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getBundleById = async (req, res) => {
  try {
    const bundle = await courseBundleService.getBundleById(req.params.id);
    res.status(200).json({
      success: true,
      data: bundle,
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

export const getBundlesByCourse = async (req, res) => {
  try {
    const bundles = await courseBundleService.getBundlesByCourse(req.params.courseId);
    res.status(200).json({
      success: true,
      count: bundles.length,
      data: bundles,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateBundle = async (req, res) => {
  try {
    const bundle = await courseBundleService.updateBundle(
      req.params.id,
      req.body,
      req.user._id,
      req.user.role
    );
    res.status(200).json({
      success: true,
      data: bundle,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteBundle = async (req, res) => {
  try {
    const result = await courseBundleService.deleteBundle(
      req.params.id,
      req.user._id,
      req.user.role
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const purchaseBundle = async (req, res) => {
  try {
    const result = await courseBundleService.purchaseBundle(req.params.id, req.user._id);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
