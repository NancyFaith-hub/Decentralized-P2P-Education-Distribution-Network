;; CourseRegistry Smart Contract
;; This contract manages the registration and lifecycle of educational courses in a decentralized manner.
;; It allows educators to register courses with IPFS hashes, update versions, manage collaborators,
;; set categories, update status, and transfer ownership. It is designed to be robust with error handling,
;; ownership checks, and additional metadata for real-world usability in a P2P education network.

;; Constants for error codes
(define-constant ERR-NOT-OWNER (err u100))
(define-constant ERR-INVALID-HASH (err u101))
(define-constant ERR-INVALID-ID (err u102))
(define-constant ERR-ALREADY-REGISTERED (err u103))
(define-constant ERR-NOT-AUTHORIZED (err u104))
(define-constant ERR-INVALID-PARAM (err u105))
(define-constant ERR-MAX-LIST-LIMIT (err u106))
(define-constant ERR-NOT-FOUND (err u107))

;; Data Variables
(define-data-var course-counter uint u0)
(define-data-var contract-owner principal tx-sender)

;; Data Maps
(define-map courses
  uint
  {
    educator: principal,
    ipfs-hash: (string-ascii 46),
    title: (string-utf8 100),
    description: (string-utf8 500),
    timestamp: uint,
    version-count: uint
  }
)

(define-map educator-course-lists
  principal
  (list 1000 uint)
)

(define-map course-versions
  { course-id: uint, version: uint }
  {
    ipfs-hash: (string-ascii 46),
    notes: (string-utf8 200),
    timestamp: uint
  }
)

(define-map course-categories
  uint
  {
    category: (string-utf8 50),
    tags: (list 20 (string-utf8 20))
  }
)

(define-map course-collaborators
  { course-id: uint, collaborator: principal }
  {
    role: (string-utf8 50),
    permissions: (list 5 (string-utf8 20)),
    added-at: uint
  }
)

(define-map course-status
  uint
  {
    status: (string-utf8 20),  ;; e.g., "draft", "published", "archived"
    visibility: bool,  ;; true for public, false for private
    last-updated: uint
  }
)

;; Public Functions

(define-public (register-course (ipfs-hash (string-ascii 46)) (title (string-utf8 100)) (description (string-utf8 500)))
  (let
    (
      (course-id (+ (var-get course-counter) u1))
      (current-list (default-to (list) (map-get? educator-course-lists tx-sender)))
    )
    (asserts! (> (len ipfs-hash) u0) ERR-INVALID-HASH)
    (asserts! (> (len title) u0) ERR-INVALID-PARAM)
    (asserts! (<= (len current-list) u999) ERR-MAX-LIST-LIMIT)
    (asserts! (<= (len description) u500) ERR-INVALID-PARAM)
    (map-set courses course-id
      {
        educator: tx-sender,
        ipfs-hash: ipfs-hash,
        title: title,
        description: description,
        timestamp: block-height,
        version-count: u1
      }
    )
    (map-set course-versions {course-id: course-id, version: u1}
      {
        ipfs-hash: ipfs-hash,
        notes: u"Initial version",
        timestamp: block-height
      }
    )
    (map-set course-status course-id
      {
        status: u"draft",
        visibility: false,
        last-updated: block-height
      }
    )
    (map-set educator-course-lists tx-sender (append current-list course-id))
    (var-set course-counter course-id)
    (print { event: "course-registered", id: course-id, educator: tx-sender })
    (ok course-id)
  )
)

(define-public (update-course-details (course-id uint) (new-title (string-utf8 100)) (new-description (string-utf8 500)))
  (let ((course (unwrap! (map-get? courses course-id) ERR-NOT-FOUND)))
    (asserts! (is-eq (get educator course) tx-sender) ERR-NOT-OWNER)
    (asserts! (or (> (len new-title) u0) (> (len new-description) u0)) ERR-INVALID-PARAM)
    (asserts! (<= (len new-description) u500) ERR-INVALID-PARAM)
    (map-set courses course-id
      (merge course
        {
          title: (if (> (len new-title) u0) new-title (get title course)),
          description: (if (> (len new-description) u0) new-description (get description course))
        }
      )
    )
    (print { event: "course-updated", id: course-id })
    (ok true)
  )
)

(define-public (register-new-version (course-id uint) (new-hash (string-ascii 46)) (notes (string-utf8 200)))
  (let
    (
      (course (unwrap! (map-get? courses course-id) ERR-NOT-FOUND))
      (new-version (+ (get version-count course) u1))
    )
    (asserts! (is-eq (get educator course) tx-sender) ERR-NOT-OWNER)
    (asserts! (> (len new-hash) u0) ERR-INVALID-HASH)
    (asserts! (<= (len notes) u200) ERR-INVALID-PARAM)
    (map-set course-versions {course-id: course-id, version: new-version}
      {
        ipfs-hash: new-hash,
        notes: notes,
        timestamp: block-height
      }
    )
    (map-set courses course-id (merge course { version-count: new-version, ipfs-hash: new-hash }))
    (map-set course-status course-id
      (merge (unwrap! (map-get? course-status course-id) ERR-NOT-FOUND) { last-updated: block-height })
    )
    (print { event: "new-version-registered", id: course-id, version: new-version })
    (ok new-version)
  )
)

(define-public (transfer-ownership (course-id uint) (new-owner principal))
  (let ((course (unwrap! (map-get? courses course-id) ERR-NOT-FOUND)))
    (asserts! (is-eq (get educator course) tx-sender) ERR-NOT-OWNER)
    (asserts! (not (is-eq new-owner tx-sender)) ERR-INVALID-PARAM)
    (map-set courses course-id (merge course { educator: new-owner }))
    (let
      (
        (old-list (unwrap! (map-get? educator-course-lists tx-sender) ERR-NOT-FOUND))
        (new-list (default-to (list) (map-get? educator-course-lists new-owner)))
      )
      (map-set educator-course-lists tx-sender (filter (lambda (id) (not (is-eq id course-id))) old-list))
      (map-set educator-course-lists new-owner (append new-list course-id))
    )
    (print { event: "ownership-transferred", id: course-id, new-owner: new-owner })
    (ok true)
  )
)

(define-public (add-category (course-id uint) (category (string-utf8 50)) (tags (list 20 (string-utf8 20))))
  (let ((course (unwrap! (map-get? courses course-id) ERR-NOT-FOUND)))
    (asserts! (is-eq (get educator course) tx-sender) ERR-NOT-OWNER)
    (asserts! (> (len category) u0) ERR-INVALID-PARAM)
    (asserts! (is-none (map-get? course-categories course-id)) ERR-ALREADY-REGISTERED)
    (map-set course-categories course-id { category: category, tags: tags })
    (print { event: "category-added", id: course-id })
    (ok true)
  )
)

(define-public (add-collaborator (course-id uint) (collaborator principal) (role (string-utf8 50)) (permissions (list 5 (string-utf8 20))))
  (let ((course (unwrap! (map-get? courses course-id) ERR-NOT-FOUND)))
    (asserts! (is-eq (get educator course) tx-sender) ERR-NOT-OWNER)
    (asserts! (not (is-some (map-get? course-collaborators {course-id: course-id, collaborator: collaborator}))) ERR-ALREADY-REGISTERED)
    (asserts! (> (len role) u0) ERR-INVALID-PARAM)
    (asserts! (> (len permissions) u0) ERR-INVALID-PARAM)
    (map-set course-collaborators {course-id: course-id, collaborator: collaborator}
      {
        role: role,
        permissions: permissions,
        added-at: block-height
      }
    )
    (print { event: "collaborator-added", id: course-id, collaborator: collaborator })
    (ok true)
  )
)

(define-public (remove-collaborator (course-id uint) (collaborator principal))
  (let ((course (unwrap! (map-get? courses course-id) ERR-NOT-FOUND)))
    (asserts! (is-eq (get educator course) tx-sender) ERR-NOT-OWNER)
    (asserts! (is-some (map-get? course-collaborators {course-id: course-id, collaborator: collaborator})) ERR-NOT-FOUND)
    (map-delete course-collaborators {course-id: course-id, collaborator: collaborator})
    (print { event: "collaborator-removed", id: course-id, collaborator: collaborator })
    (ok true)
  )
)

(define-public (update-status (course-id uint) (new-status (string-utf8 20)) (new-visibility bool))
  (let ((course (unwrap! (map-get? courses course-id) ERR-NOT-FOUND)))
    (asserts! (is-eq (get educator course) tx-sender) ERR-NOT-OWNER)
    (asserts! (> (len new-status) u0) ERR-INVALID-PARAM)
    (map-set course-status course-id
      {
        status: new-status,
        visibility: new-visibility,
        last-updated: block-height
      }
    )
    (print { event: "status-updated", id: course-id, status: new-status })
    (ok true)
  )
)

;; Read-Only Functions

(define-read-only (get-course (course-id uint))
  (map-get? courses course-id)
)

(define-read-only (get-course-version (course-id uint) (version uint))
  (map-get? course-versions {course-id: course-id, version: version})
)

(define-read-only (get-course-category (course-id uint))
  (map-get? course-categories course-id)
)

(define-read-only (get-course-collaborator (course-id uint) (collaborator principal))
  (map-get? course-collaborators {course-id: course-id, collaborator: collaborator})
)

(define-read-only (get-course-status (course-id uint))
  (map-get? course-status course-id)
)

(define-read-only (get-courses-by-educator (educator principal))
  (map-get? educator-course-lists educator)
)

(define-read-only (get-course-count)
  (ok (var-get course-counter))
)

(define-read-only (is-owner (course-id uint) (user principal))
  (let ((course (map-get? courses course-id)))
    (ok (and (is-some course) (is-eq (get educator (unwrap-panic course)) user)))
  )
)

(define-read-only (has-permission (course-id uint) (user principal) (permission (string-utf8 20)))
  (let
    (
      (collab (map-get? course-collaborators {course-id: course-id, collaborator: user}))
    )
    (if (is-some collab)
      (fold (lambda (perm acc) (or acc (is-eq perm permission)))
        (get permissions (unwrap-panic collab)) false)
      false
    )
  )
)

;; Private Functions

(define-private (filter (pred (lambda (a) bool)) (lst (list 1000 uint)))
  (fold (lambda (item acc)
          (if (pred item)
            (append acc item)
            acc))
    lst (list))
)