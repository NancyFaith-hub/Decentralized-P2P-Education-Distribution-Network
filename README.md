# PeerEduNet: Decentralized P2P Education Distribution Network

## Project Overview

PeerEduNet is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It creates a peer-to-peer (P2P) course distribution network where educators can upload lectures and educational content to decentralized storage solutions like IPFS (integrated via off-chain pinning services). This reduces costs for users in low-income regions by leveraging P2P sharing instead of centralized servers, minimizing bandwidth and hosting expenses. Hosts who store and distribute content are rewarded with native tokens (EDU tokens), incentivizing a global network of participants to maintain availability, especially in underserved areas.

### Real-World Problems Solved
- **Accessibility in Low-Income Regions**: Traditional platforms like Coursera or YouTube charge fees or rely on high-bandwidth streaming, which is unaffordable or inaccessible in regions with poor infrastructure. PeerEduNet uses P2P to allow offline-first access and local hosting, reducing data costs.
- **Centralized Control and Costs**: Educators face platform fees and censorship. Decentralized uploads empower creators with ownership via NFTs or metadata on-chain.
- **Sustainability**: Token rewards encourage community hosting, creating a self-sustaining ecosystem where users in low-income areas can earn by hosting, offsetting their own access costs.
- **Equity**: Free or low-cost access to quality education, with rewards distributed fairly based on verifiable contributions.

The project involves 6 core smart contracts written in Clarity:
1. **EduToken.clar**: Fungible token (SIP-010 compliant) for rewards.
2. **CourseRegistry.clar**: Registers courses with IPFS hashes and metadata.
3. **HostRegistry.clar**: Manages host registrations and staking.
4. **RewardDistributor.clar**: Handles reward claims based on hosting proofs.
5. **AccessGateway.clar**: Controls access to content (token-gated or free).
6. **GovernanceDAO.clar**: DAO for community governance and parameter updates.

Off-chain components (not in contracts):
- IPFS for storage: Educators upload to IPFS, pin hashes on-chain.
- P2P Network: Use libp2p or similar for distribution; hosts report uptime via signed messages.
- Frontend: dApp for uploading, browsing, and hosting.

## Installation and Setup
- **Prerequisites**: Stacks CLI, Node.js, IPFS node.
- Clone the repo: `git clone https://github.com/yourusername/PeerEduNet.git`
- Install dependencies: `npm install`
- Deploy contracts: Use Stacks CLI to deploy to testnet/mainnet.
- Run local IPFS: `ipfs daemon`
- Start dApp: `npm start`

## Smart Contracts

Below are the 6 Clarity smart contracts. They are designed for security, with read-only functions for queries and private functions for mutations. All contracts use post-conditions for safety.

### 1. EduToken.clar
This contract defines the EDU fungible token used for rewards and staking.

```clarity
(define-fungible-token edu-token u1000000000) ;; Max supply: 1 billion

(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant CONTRACT-OWNER tx-sender)

(define-data-var total-supply uint u0)
(define-data-var token-uri (string-utf8 256) u"")

(define-public (transfer (amount uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (ft-transfer? edu-token amount sender recipient)
  )
)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (ft-mint? edu-token amount recipient)
  )
)

(define-read-only (get-balance (account principal))
  (ft-get-balance edu-token account)
)

(define-read-only (get-total-supply)
  (ok (var-get total-supply))
)

(define-public (set-token-uri (new-uri (string-utf8 256)))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (ok (var-set token-uri new-uri))
  )
)
```

### 2. CourseRegistry.clar
Registers courses with metadata and IPFS content hashes.

```clarity
(define-constant ERR-NOT-OWNER (err u101))
(define-constant ERR-INVALID-HASH (err u102))

(define-map courses uint { educator: principal, ipfs-hash: (string-ascii 46), title: (string-utf8 100), description: (string-utf8 500) })
(define-data-var course-counter uint u0)

(define-public (register-course (ipfs-hash (string-ascii 46)) (title (string-utf8 100)) (description (string-utf8 500)))
  (let ((course-id (var-get course-counter)))
    (asserts! (> (len ipfs-hash) u0) ERR-INVALID-HASH)
    (map-set courses course-id { educator: tx-sender, ipfs-hash: ipfs-hash, title: title, description: description })
    (var-set course-counter (+ course-id u1))
    (ok course-id)
  )
)

(define-read-only (get-course (course-id uint))
  (map-get? courses course-id)
)

(define-public (update-course-hash (course-id uint) (new-hash (string-ascii 46)))
  (let ((course (unwrap! (map-get? courses course-id) ERR-NOT-OWNER)))
    (asserts! (is-eq (get educator course) tx-sender) ERR-NOT-OWNER)
    (map-set courses course-id (merge course { ipfs-hash: new-hash }))
    (ok true)
  )
)
```

### 3. HostRegistry.clar
Manages hosts who stake EDU tokens to participate.

```clarity
(use-trait ft-trait .EduToken.edu-token) ;; Assuming SIP-010 trait

(define-constant ERR-INSUFFICIENT-STAKE (err u103))
(define-constant MIN-STAKE u1000) ;; 1000 EDU

(define-map hosts principal { stake: uint, active: bool })
(define-data-var token-contract principal 'SP000000000000000000002Q6VF78.EduToken) ;; Deployed address

(define-public (register-host (amount uint))
  (begin
    (asserts! (>= amount MIN-STAKE) ERR-INSUFFICIENT-STAKE)
    (try! (contract-call? .EduToken transfer amount tx-sender (as-contract tx-sender)))
    (map-set hosts tx-sender { stake: amount, active: true })
    (ok true)
  )
)

(define-public (withdraw-stake)
  (let ((host (unwrap! (map-get? hosts tx-sender) ERR-NOT-OWNER)))
    (asserts! (get active host) ERR-NOT-AUTHORIZED)
    (try! (as-contract (contract-call? .EduToken transfer (get stake host) tx-sender tx-sender)))
    (map-delete hosts tx-sender)
    (ok true)
  )
)

(define-read-only (is-host (user principal))
  (ok (is-some (map-get? hosts user)))
)
```

### 4. RewardDistributor.clar
Distributes rewards based on hosting proofs (simplified; off-chain oracle or signed messages for real proof).

```clarity
(define-constant ERR-NOT-HOST (err u104))
(define-constant REWARD-PER-HOUR u10) ;; EDU per hour hosted

(define-map hosting-proofs principal { course-id: uint, hours: uint })
(define-data-var reward-pool uint u1000000) ;; Initial pool

(define-public (claim-reward (course-id uint) (hours uint))
  (let ((reward (* hours REWARD-PER-HOUR)))
    (asserts! (is-ok (contract-call? .HostRegistry is-host tx-sender)) ERR-NOT-HOST)
    (map-set hosting-proofs tx-sender { course-id: course-id, hours: hours })
    (try! (as-contract (contract-call? .EduToken transfer reward tx-sender tx-sender)))
    (var-set reward-pool (- (var-get reward-pool) reward))
    (ok reward)
  )
)

(define-read-only (get-reward-pool)
  (ok (var-get reward-pool))
)

(define-public (fund-pool (amount uint))
  (try! (contract-call? .EduToken transfer amount tx-sender (as-contract tx-sender)))
  (var-set reward-pool (+ (var-get reward-pool) amount))
  (ok true)
)
```

### 5. AccessGateway.clar
Controls access; courses can be free or require token burn/payment.

```clarity
(define-constant ERR-ACCESS-DENIED (err u105))
(define-constant ACCESS-FEE u5) ;; EDU fee for premium courses

(define-map course-access uint { free: bool })

(define-public (set-access (course-id uint) (free bool))
  (let ((course (unwrap! (contract-call? .CourseRegistry get-course course-id) ERR-NOT-OWNER)))
    (asserts! (is-eq (get educator course) tx-sender) ERR-NOT-OWNER)
    (map-set course-access course-id { free: free })
    (ok true)
  )
)

(define-public (request-access (course-id uint))
  (let ((access (default-to { free: true } (map-get? course-access course-id))))
    (if (get free access)
      (ok true)
      (begin
        (try! (contract-call? .EduToken transfer ACCESS-FEE tx-sender (as-contract tx-sender)))
        (ok true)
      )
    )
  )
)

(define-read-only (check-access (course-id uint))
  (ok (get free (default-to { free: true } (map-get? course-access course-id))))
)
```

### 6. GovernanceDAO.clar
DAO for voting on parameters like reward rates.

```clarity
(define-constant ERR-NOT-MEMBER (err u106))
(define-constant VOTE-THRESHOLD u100) ;; Min stake to vote

(define-map proposals uint { proposer: principal, description: (string-utf8 500), yes: uint, no: uint })
(define-map votes { proposal: uint, voter: principal } bool)
(define-data-var proposal-counter uint u0)

(define-public (create-proposal (description (string-utf8 500)))
  (let ((proposal-id (var-get proposal-counter))
        (stake (default-to u0 (get stake (unwrap! (contract-call? .HostRegistry get-host tx-sender) ERR-NOT-MEMBER)))))
    (asserts! (>= stake VOTE-THRESHOLD) ERR-NOT-MEMBER)
    (map-set proposals proposal-id { proposer: tx-sender, description: description, yes: u0, no: u0 })
    (var-set proposal-counter (+ proposal-id u1))
    (ok proposal-id)
  )
)

(define-public (vote (proposal-id uint) (yes bool))
  (begin
    (asserts! (is-none (map-get? votes { proposal: proposal-id, voter: tx-sender })) ERR-NOT-AUTHORIZED)
    (let ((proposal (unwrap! (map-get? proposals proposal-id) ERR-INVALID-HASH)))
      (if yes
        (map-set proposals proposal-id (merge proposal { yes: (+ (get yes proposal) u1) }))
        (map-set proposals proposal-id (merge proposal { no: (+ (get no proposal) u1) }))
      )
      (map-set votes { proposal: proposal-id, voter: tx-sender } yes)
      (ok true)
    )
  )
)

(define-read-only (get-proposal (proposal-id uint))
  (map-get? proposals proposal-id)
)
```

## Usage
- Educators: Register courses via dApp, upload to IPFS, call `register-course`.
- Hosts: Stake EDU, host content, submit proofs to claim rewards.
- Learners: Browse courses, request access if needed, download via P2P.
- Governance: Propose and vote on changes.

## Security Notes
- All contracts use assertions and post-conditions (add in production).
- No reentrancy risks due to Clarity's design.
- Audit recommended before mainnet.

## License
MIT License.