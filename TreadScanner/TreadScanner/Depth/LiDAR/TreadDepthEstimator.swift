import Foundation
import simd

/// Pure-math tread depth estimator. No ARKit types, so it is unit-testable anywhere.
///
/// Input per frame: a set of 3D points (metres, camera space) inside the scan region.
/// Steps:
///  1. RANSAC plane fit to the dominant surface (the tread blocks).
///  2. Points more than `grooveThresholdMM` below the plane are groove-floor candidates.
///  3. Groove depth for the frame = robust median of the deepest cluster of those points.
///  4. Across frames: mean and standard deviation.
///
/// Measuring relative to a fitted plane cancels most of the LiDAR's absolute error, which
/// is what makes ~1 mm plausible even though single depth samples are noisier.
struct TreadDepthEstimator {
    struct Plane {
        var normal: SIMD3<Double>   // unit length, pointing toward the camera (negative z)
        var d: Double               // dot(normal, p) + d = 0

        func signedDistance(_ p: SIMD3<Double>) -> Double { simd_dot(normal, p) + d }
    }

    struct FrameEstimate {
        var depthMM: Double
        var groovePointCount: Int
        var surfacePointCount: Int
    }

    /// Surface model for the tread blocks. A truck tire (radius ~0.5 m) sags ~0.9 mm over a
    /// 6 cm patch, more than 1/32", so the default fits a quadratic surface to the RANSAC
    /// plane inliers. `.plane` is kept for comparison in the accuracy study.
    enum SurfaceModel { case plane, quadratic }
    var surfaceModel: SurfaceModel = .quadratic
    var grooveThresholdMM: Double = 1.0
    var maxTreadDepthMM: Double = 30.0        // anything deeper is background, not a groove
    var ransacIterations: Int = 120
    /// RANSAC inlier band. Must be well under half the shallowest groove we care about (2/32 =
    /// 1.6 mm), otherwise a plane halfway between tread and groove floor collects every point
    /// and the groove disappears. 0.6 mm chosen by tools/treadlab sweep on synthetic tires.
    var ransacInlierMM: Double = 0.6
    var minSurfacePoints: Int = 60
    var minGroovePoints: Int = 12
    var seed: UInt64 = 0x5EED

    // MARK: Per frame

    func estimateFrame(points: [SIMD3<Double>]) -> FrameEstimate? {
        guard points.count >= minSurfacePoints, let plane = fitPlane(points) else { return nil }

        // Depth below the tread surface in mm. The normal points toward the camera, so points
        // farther away (groove floors) have a negative signed distance; flip the sign so that
        // positive = deeper into the tire.
        var dist = points.map { -plane.signedDistance($0) * 1000.0 }

        if surfaceModel == .quadratic, let quad = fitQuadratic(points: points, plane: plane, residuals: dist) {
            // Re-measure every point against the curved surface instead of the plane.
            dist = zip(points, dist).map { p, d in d + quad.height(at: p) }
        }

        // Surface noise from the points ABOVE the plane (negative depth). Those can never be
        // groove, so the estimate is not polluted by shallow grooves the way a two-sided band is.
        // Robust MAD estimate; the groove threshold then adapts to the device's noise.
        let above = dist.filter { $0 < 0 && $0 > -3 * ransacInlierMM }.map { -$0 }.sorted()
        guard above.count >= minSurfacePoints / 2 else { return nil }
        let sigma = 1.4826 * median(above)
        let threshold = max(grooveThresholdMM, 3 * sigma)

        var surface = 0
        var candidates: [Double] = []
        candidates.reserveCapacity(points.count / 4)
        for d in dist {
            if abs(d) <= ransacInlierMM { surface += 1 }
            else if d > threshold && d < maxTreadDepthMM { candidates.append(d) }
        }
        guard surface >= minSurfacePoints, candidates.count >= minGroovePoints else { return nil }

        // Groove floors are parallel to the tread surface, so their distances cluster at one
        // value. Find the densest window (mode) and average inside it: unbiased for symmetric
        // noise, and it ignores groove-wall points, which are spread thinly between 0 and the floor.
        candidates.sort()
        let window = 2 * ransacInlierMM
        var bestStart = 0, bestEnd = 0, hi = 0
        for lo in 0..<candidates.count {
            while hi < candidates.count && candidates[hi] - candidates[lo] <= window { hi += 1 }
            if hi - lo > bestEnd - bestStart { bestStart = lo; bestEnd = hi }
        }
        let floor = candidates[bestStart..<bestEnd]
        guard floor.count >= minGroovePoints else { return nil }
        let depth = floor.reduce(0, +) / Double(floor.count)
        return FrameEstimate(depthMM: depth, groovePointCount: floor.count, surfacePointCount: surface)
    }

    // MARK: Across frames

    func combine(_ frames: [FrameEstimate]) -> DepthResult? {
        guard !frames.isEmpty else { return nil }
        let depths = frames.map(\.depthMM)
        // Trim 10% each side to drop frames hit by motion blur or a bad plane.
        let sorted = depths.sorted()
        let trim = sorted.count >= 10 ? sorted.count / 10 : 0
        let trimmed = Array(sorted[trim..<(sorted.count - trim)])
        let mean = trimmed.reduce(0, +) / Double(trimmed.count)
        let variance = trimmed.count > 1
            ? trimmed.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(trimmed.count - 1)
            : 0
        // Single-frame fallback still reports some uncertainty so the UI does not overclaim.
        let sd = trimmed.count > 1 ? variance.squareRoot() : 1.5
        return DepthResult(
            depthMM: mean,
            uncertaintyMM: sd,
            frameCount: frames.count,
            pointCount: frames.reduce(0) { $0 + $1.groovePointCount },
            method: .scan
        )
    }

    // MARK: Plane fit

    func fitPlane(_ points: [SIMD3<Double>]) -> Plane? {
        guard points.count >= 3 else { return nil }
        var rng = SplitMix64(seed: seed)
        var best: Plane?
        var bestInliers = 0
        let inlierM = ransacInlierMM / 1000.0

        for _ in 0..<ransacIterations {
            let a = points[Int(rng.next() % UInt64(points.count))]
            let b = points[Int(rng.next() % UInt64(points.count))]
            let c = points[Int(rng.next() % UInt64(points.count))]
            guard let candidate = Plane(a, b, c) else { continue }
            var inliers = 0
            for p in points where abs(candidate.signedDistance(p)) <= inlierM { inliers += 1 }
            if inliers > bestInliers {
                bestInliers = inliers
                best = candidate
            }
        }
        guard let rough = best, bestInliers >= 3 else { return nil }

        // Refine with a least-squares fit over the inliers (centroid + smallest covariance axis).
        let inliers = points.filter { abs(rough.signedDistance($0)) <= inlierM }
        return refine(inliers) ?? rough
    }

    // MARK: Quadratic surface (curvature correction)

    /// Height of the tread surface above the RANSAC plane, as a quadratic in plane-local (u, v):
    /// h = a·u² + b·v² + c·u·v + d·u + e·v + f, in mm. Positive h = surface is closer to the
    /// camera than the plane (bulging toward it, as the middle of a convex tire does).
    struct QuadraticSurface {
        var coeffs: [Double]        // a, b, c, d, e, f
        var origin: SIMD3<Double>
        var u: SIMD3<Double>
        var v: SIMD3<Double>

        func height(at p: SIMD3<Double>) -> Double {
            let r = p - origin
            let x = simd_dot(r, u), y = simd_dot(r, v)
            let c = coeffs
            return c[0]*x*x + c[1]*y*y + c[2]*x*y + c[3]*x + c[4]*y + c[5]
        }
    }

    /// Least-squares quadratic through the tread-surface points. The band is asymmetric:
    /// up to 2 × inlier above the plane (a curved surface's edges), but only 1 × inlier below,
    /// so groove walls and blurred groove edges do not drag the surface down.
    /// Residual sign follows `dist`: positive = deeper, so the fitted height is the negative of that.
    func fitQuadratic(points: [SIMD3<Double>], plane: Plane, residuals dist: [Double]) -> QuadraticSurface? {
        var idx: [Int] = []
        idx.reserveCapacity(points.count)
        for i in 0..<points.count where dist[i] >= -2 * ransacInlierMM && dist[i] <= ransacInlierMM { idx.append(i) }
        guard idx.count >= 30 else { return nil }

        // Plane-local axes: u = any direction in the plane, v = n × u.
        let n = plane.normal
        let seed: SIMD3<Double> = abs(n.x) < 0.9 ? SIMD3(1, 0, 0) : SIMD3(0, 1, 0)
        let u = simd_normalize(simd_cross(n, seed))
        let v = simd_cross(n, u)
        var origin = SIMD3<Double>(0, 0, 0)
        for i in idx { origin += points[i] }
        origin /= Double(idx.count)

        // Normal equations for 6 coefficients. Coordinates in mm so the matrix is well scaled.
        var ata = [Double](repeating: 0, count: 36)
        var atb = [Double](repeating: 0, count: 6)
        for i in idx {
            let r = points[i] - origin
            let x = simd_dot(r, u) * 1000, y = simd_dot(r, v) * 1000
            let row = [x*x, y*y, x*y, x, y, 1]
            let h = -dist[i]                    // height above plane, mm
            for a in 0..<6 {
                atb[a] += row[a] * h
                for b in 0..<6 { ata[a*6 + b] += row[a] * row[b] }
            }
        }
        guard let sol = TreadDepthEstimator.solve6(ata, atb) else { return nil }
        // Coefficients were fit in mm units of (x, y); convert so height(at:) takes metres.
        let k = 1000.0
        let coeffs = [sol[0]*k*k, sol[1]*k*k, sol[2]*k*k, sol[3]*k, sol[4]*k, sol[5]]
        return QuadraticSurface(coeffs: coeffs, origin: origin, u: u, v: v)
    }

    /// Gaussian elimination with partial pivoting for a 6×6 system.
    static func solve6(_ a: [Double], _ b: [Double]) -> [Double]? {
        var m = a, r = b
        let n = 6
        for col in 0..<n {
            var piv = col
            for row in (col + 1)..<n where abs(m[row*n + col]) > abs(m[piv*n + col]) { piv = row }
            guard abs(m[piv*n + col]) > 1e-12 else { return nil }
            if piv != col {
                for k in 0..<n { m.swapAt(col*n + k, piv*n + k) }
                r.swapAt(col, piv)
            }
            for row in (col + 1)..<n {
                let f = m[row*n + col] / m[col*n + col]
                if f == 0 { continue }
                for k in col..<n { m[row*n + k] -= f * m[col*n + k] }
                r[row] -= f * r[col]
            }
        }
        var x = [Double](repeating: 0, count: n)
        for row in stride(from: n - 1, through: 0, by: -1) {
            var s = r[row]
            for k in (row + 1)..<n { s -= m[row*n + k] * x[k] }
            x[row] = s / m[row*n + row]
        }
        return x
    }

    private func refine(_ pts: [SIMD3<Double>]) -> Plane? {
        guard pts.count >= 3 else { return nil }
        let n = Double(pts.count)
        let centroid = pts.reduce(SIMD3<Double>(0, 0, 0), +) / n
        var xx = 0.0, xy = 0.0, xz = 0.0, yy = 0.0, yz = 0.0, zz = 0.0
        for p in pts {
            let r = p - centroid
            xx += r.x * r.x; xy += r.x * r.y; xz += r.x * r.z
            yy += r.y * r.y; yz += r.y * r.z; zz += r.z * r.z
        }
        // Normal = eigenvector of the smallest eigenvalue. Use the cross-product trick
        // (Emil Ernerfeldt): pick the largest determinant among the three axis choices.
        let detX = yy * zz - yz * yz
        let detY = xx * zz - xz * xz
        let detZ = xx * yy - xy * xy
        let detMax = max(detX, detY, detZ)
        guard detMax > 0 else { return nil }
        var normal: SIMD3<Double>
        if detMax == detX {
            normal = SIMD3(detX, xz * yz - xy * zz, xy * yz - xz * yy)
        } else if detMax == detY {
            normal = SIMD3(xz * yz - xy * zz, detY, xy * xz - yz * xx)
        } else {
            normal = SIMD3(xy * yz - xz * yy, xy * xz - yz * xx, detZ)
        }
        normal = simd_normalize(normal)
        // Orient toward the camera (camera looks down -z in ARKit camera space).
        if normal.z < 0 { normal = -normal }
        return Plane(normal: normal, d: -simd_dot(normal, centroid))
    }

    private func median(_ sorted: [Double]) -> Double {
        let n = sorted.count
        if n == 0 { return 0 }
        return n % 2 == 1 ? sorted[n / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    }
}

extension TreadDepthEstimator.Plane {
    init?(_ a: SIMD3<Double>, _ b: SIMD3<Double>, _ c: SIMD3<Double>) {
        let n = simd_cross(b - a, c - a)
        let len = simd_length(n)
        guard len > 1e-12 else { return nil }
        var unit = n / len
        if unit.z < 0 { unit = -unit }
        self.normal = unit
        self.d = -simd_dot(unit, a)
    }
}

/// Small deterministic RNG so RANSAC is reproducible in tests.
struct SplitMix64 {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}
