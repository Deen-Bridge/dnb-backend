import courseBundleService from "../services/course-bundle.service.js";
import { bundleHandler } from "../utils/courseBundleErrors.js";

// Request shapes are enforced by validators/courseBundleValidators.js, so the
// handlers only pick the fields each operation is allowed to use and never
// forward raw req.body/req.query objects to the service.

const actorOf = (req) => ({ id: req.user._id, role: req.user.role });

const pick = (source = {}, fields) =>
  Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));

const sendPage = (res, { bundles, pagination }) =>
  res.status(200).json({
    success: true,
    count: bundles.length,
    data: bundles,
    pagination,
  });

export const createBundle = bundleHandler("create", async (req, res) => {
  const bundle = await courseBundleService.createBundle(
    pick(req.body, ["title", "description", "courses", "price", "currency"]),
    actorOf(req)
  );
  res.status(201).json({ success: true, data: bundle });
});

export const getBundles = bundleHandler("list", async (req, res) => {
  const result = await courseBundleService.getBundles(
    pick(req.query, ["courseId", "createdBy", "search", "page", "limit", "sort"])
  );
  sendPage(res, result);
});

export const getBundleById = bundleHandler("get", async (req, res) => {
  const bundle = await courseBundleService.getBundleById(req.params.id);
  res.status(200).json({ success: true, data: bundle });
});

export const getBundlesByCourse = bundleHandler("list_by_course", async (req, res) => {
  const result = await courseBundleService.getBundlesByCourse(
    req.params.courseId,
    pick(req.query, ["page", "limit", "sort"])
  );
  sendPage(res, result);
});

export const updateBundle = bundleHandler("update", async (req, res) => {
  const bundle = await courseBundleService.updateBundle(
    req.params.id,
    pick(req.body, ["title", "description", "courses", "price", "currency"]),
    actorOf(req)
  );
  res.status(200).json({ success: true, data: bundle });
});

export const deleteBundle = bundleHandler("delete", async (req, res) => {
  const result = await courseBundleService.deleteBundle(req.params.id, actorOf(req));
  res.status(200).json(result);
});

export const purchaseBundle = bundleHandler("purchase", async (req, res) => {
  const result = await courseBundleService.purchaseBundle(req.params.id, req.user._id);
  res.status(200).json(result);
});
