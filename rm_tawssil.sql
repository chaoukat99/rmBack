-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Hôte : 127.0.0.1
-- Généré le : jeu. 16 avr. 2026 à 13:02
-- Version du serveur : 10.4.32-MariaDB
-- Version de PHP : 8.1.25

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de données : `rm_tawssil`
--

-- --------------------------------------------------------

--
-- Structure de la table `deliveries`
--

CREATE TABLE `deliveries` (
  `id` varchar(36) NOT NULL,
  `client_id` varchar(36) NOT NULL,
  `transporter_id` varchar(36) DEFAULT NULL,
  `voyage_id` varchar(36) DEFAULT NULL,
  `tracking_code` varchar(100) DEFAULT NULL,
  `origin` varchar(255) DEFAULT NULL,
  `destination` varchar(255) DEFAULT NULL,
  `pickup_address` text DEFAULT NULL,
  `pickup_phone` varchar(30) DEFAULT NULL,
  `package_type` varchar(100) DEFAULT NULL,
  `weight` varchar(50) DEFAULT NULL,
  `dimensions` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `declared_value` decimal(10,2) DEFAULT NULL,
  `price` decimal(10,2) DEFAULT NULL,
  `is_urgent` tinyint(1) NOT NULL DEFAULT 0,
  `is_insured` tinyint(1) NOT NULL DEFAULT 0,
  `status` enum('Pending','Accepted','In Transit','Delivered','Cancelled') NOT NULL DEFAULT 'Pending',
  `current_lat` decimal(10,8) DEFAULT NULL,
  `current_lng` decimal(11,8) DEFAULT NULL,
  `pickup_status` enum('pending','requested','accepted','completed') DEFAULT 'pending',
  `request_date` date DEFAULT NULL,
  `pickup_date` date DEFAULT NULL,
  `delivery_date` date DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Déchargement des données de la table `deliveries`
--

INSERT INTO `deliveries` (`id`, `client_id`, `transporter_id`, `voyage_id`, `tracking_code`, `origin`, `destination`, `pickup_address`, `pickup_phone`, `package_type`, `weight`, `dimensions`, `description`, `declared_value`, `price`, `is_urgent`, `is_insured`, `status`, `current_lat`, `current_lng`, `pickup_status`, `request_date`, `pickup_date`, `delivery_date`, `created_at`, `updated_at`) VALUES
('04e02a5c-198a-4309-924c-25597f648e50', 'db274a83-fb8c-4ef1-b4b9-419436a1540d', NULL, NULL, 'RT-2026-AYRV-1269', 'Casablanca, Morocco', 'Madrid, Spain', 'À préciser via chat', '066655223', 'Normal', '20kg', NULL, 'Test', NULL, NULL, 0, 0, 'Pending', NULL, NULL, 'pending', '2026-04-01', NULL, NULL, '2026-04-01 22:55:44', '2026-04-01 22:55:44');

-- --------------------------------------------------------

--
-- Structure de la table `messages`
--

CREATE TABLE `messages` (
  `id` varchar(36) NOT NULL,
  `delivery_id` varchar(36) NOT NULL,
  `sender_id` varchar(36) NOT NULL,
  `recipient_id` varchar(36) NOT NULL,
  `content` text NOT NULL,
  `message_type` enum('text','image','audio','file','pickup_request','pickup_accepted') NOT NULL DEFAULT 'text',
  `file_size` int(11) DEFAULT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Structure de la table `notifications`
--

CREATE TABLE `notifications` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `type` varchar(50) NOT NULL,
  `title` varchar(255) NOT NULL,
  `body` text NOT NULL,
  `delivery_id` varchar(36) DEFAULT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Déchargement des données de la table `notifications`
--

INSERT INTO `notifications` (`id`, `user_id`, `type`, `title`, `body`, `delivery_id`, `is_read`, `created_at`) VALUES
('71d310e5-c272-46a6-a2a6-a5df1111ee98', '62ca110b-ed47-4a8f-aeca-156d0e90f636', 'message', '💬 Nouveau Message', 'Omar Samir vous a envoyé un message.', NULL, 0, '2026-04-11 17:54:36'),
('c984da50-db2e-40c1-8aa1-75d4f43106d8', '62ca110b-ed47-4a8f-aeca-156d0e90f636', 'message', '💬 Nouveau Message', 'Omar Samir vous a envoyé un message.', NULL, 0, '2026-04-11 17:54:16'),
('e130c136-fb11-4949-800e-e76012d098cd', '62ca110b-ed47-4a8f-aeca-156d0e90f636', 'message', '💬 Nouveau Message', 'Omar Samir vous a envoyé un message.', NULL, 0, '2026-03-22 16:52:47');

-- --------------------------------------------------------

--
-- Structure de la table `ratings`
--

CREATE TABLE `ratings` (
  `id` varchar(36) NOT NULL,
  `delivery_id` varchar(36) NOT NULL,
  `client_id` varchar(36) NOT NULL,
  `transporter_id` varchar(36) NOT NULL,
  `stars` tinyint(4) NOT NULL CHECK (`stars` between 1 and 5),
  `comment` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Structure de la table `reclamations`
--

CREATE TABLE `reclamations` (
  `id` varchar(36) NOT NULL,
  `client_id` varchar(36) NOT NULL,
  `delivery_id` varchar(36) NOT NULL,
  `subject` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `status` enum('open','in_review','resolved','closed') NOT NULL DEFAULT 'open',
  `admin_note` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Structure de la table `shipping_routes`
--

CREATE TABLE `shipping_routes` (
  `id` varchar(36) NOT NULL,
  `from_country` varchar(100) NOT NULL,
  `to_country` varchar(100) NOT NULL,
  `cities` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`cities`)),
  `distance_km` int(11) DEFAULT NULL,
  `avg_duration_days` int(11) DEFAULT NULL,
  `avg_price` decimal(10,2) DEFAULT NULL,
  `popularity` int(11) NOT NULL DEFAULT 0,
  `active_transporters` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Structure de la table `support_tickets`
--

CREATE TABLE `support_tickets` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `subject` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `status` enum('open','replied','closed') NOT NULL DEFAULT 'open',
  `admin_reply` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Structure de la table `transporter_documents`
--

CREATE TABLE `transporter_documents` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `doc_type` enum('driver_license','national_id','insurance','vehicle_registration','vehicle_photo','other') NOT NULL,
  `file_url` varchar(500) NOT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `admin_note` text DEFAULT NULL,
  `uploaded_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `reviewed_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Déchargement des données de la table `transporter_documents`
--

INSERT INTO `transporter_documents` (`id`, `user_id`, `doc_type`, `file_url`, `status`, `admin_note`, `uploaded_at`, `reviewed_at`) VALUES
('25bbb327-3ec7-4478-a985-e8c532a0a260', '1adebac4-000e-42ed-a504-7db74ccbf980', 'vehicle_registration', '/uploads/documents/registration_document-1775084366409-661647384.jpg', 'pending', NULL, '2026-04-01 22:59:27', NULL),
('25f3b3c4-903f-4e5b-a6c7-83efb4c5e54c', '1adebac4-000e-42ed-a504-7db74ccbf980', 'vehicle_photo', '/uploads/documents/vehicle_photos-1775084366429-229651298.png', 'pending', NULL, '2026-04-01 22:59:27', NULL),
('29793802-171b-409b-af61-0d0b3afc6147', '62ca110b-ed47-4a8f-aeca-156d0e90f636', 'vehicle_photo', '/uploads/documents/vehicle_photos-1774198103474-546405062.png', 'pending', NULL, '2026-03-22 16:48:23', NULL),
('2b095688-09ac-4d5b-a58e-4f33dfaedef6', '62ca110b-ed47-4a8f-aeca-156d0e90f636', 'vehicle_photo', '/uploads/documents/vehicle_photos-1774198103352-41986769.png', 'pending', NULL, '2026-03-22 16:48:23', NULL),
('588362e7-815b-4f67-8e1b-665868020eba', '62ca110b-ed47-4a8f-aeca-156d0e90f636', 'vehicle_photo', '/uploads/documents/vehicle_photos-1774198102988-874859883.png', 'pending', NULL, '2026-03-22 16:48:23', NULL),
('8db087b6-843f-442e-a9ef-8e38945cb87c', '1adebac4-000e-42ed-a504-7db74ccbf980', 'driver_license', '/uploads/documents/driver_license-1775084366358-143334501.jpg', 'pending', NULL, '2026-04-01 22:59:27', NULL),
('9a25f991-ae7b-4f71-83fa-8c5a023e3a06', '62ca110b-ed47-4a8f-aeca-156d0e90f636', 'vehicle_photo', '/uploads/documents/vehicle_photos-1774198103590-21193566.png', 'pending', NULL, '2026-03-22 16:48:23', NULL),
('9ffb05e5-5365-4119-a2b4-b9813f408108', '1adebac4-000e-42ed-a504-7db74ccbf980', 'vehicle_photo', '/uploads/documents/vehicle_photos-1775084366637-793871921.heic', 'pending', NULL, '2026-04-01 22:59:27', NULL),
('a56e6551-d019-424a-b18a-60ff5503b4ce', '62ca110b-ed47-4a8f-aeca-156d0e90f636', 'vehicle_registration', '/uploads/documents/registration_document-1774198102961-233651987.jpg', 'pending', NULL, '2026-03-22 16:48:23', NULL),
('c9a737dd-7094-46c2-8d99-bbc8e82d1882', '62ca110b-ed47-4a8f-aeca-156d0e90f636', 'vehicle_photo', '/uploads/documents/vehicle_photos-1774198103180-367771712.png', 'pending', NULL, '2026-03-22 16:48:23', NULL),
('e2006e8e-12a7-4f43-bdb2-5924b0c7dbb8', '62ca110b-ed47-4a8f-aeca-156d0e90f636', 'driver_license', '/uploads/documents/driver_license-1774198102914-472667863.jpg', 'pending', NULL, '2026-03-22 16:48:23', NULL);

-- --------------------------------------------------------

--
-- Structure de la table `transporter_profiles`
--

CREATE TABLE `transporter_profiles` (
  `user_id` varchar(36) NOT NULL,
  `vehicle` varchar(255) DEFAULT NULL,
  `vehicle_capacity` varchar(100) DEFAULT NULL,
  `license_number` varchar(100) DEFAULT NULL,
  `rating` decimal(3,2) NOT NULL DEFAULT 0.00,
  `total_deliveries` int(11) NOT NULL DEFAULT 0,
  `active_deliveries` int(11) NOT NULL DEFAULT 0,
  `earnings` decimal(12,2) NOT NULL DEFAULT 0.00,
  `verified` tinyint(1) NOT NULL DEFAULT 0,
  `countries` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`countries`)),
  `next_trip` date DEFAULT NULL,
  `bio` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `subscription_status` enum('none','pending','active') NOT NULL DEFAULT 'none',
  `subscription_expires_at` datetime DEFAULT NULL,
  `terms_accepted` tinyint(1) NOT NULL DEFAULT 0,
  `terms_accepted_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Déchargement des données de la table `transporter_profiles`
--

INSERT INTO `transporter_profiles` (`user_id`, `vehicle`, `vehicle_capacity`, `license_number`, `rating`, `total_deliveries`, `active_deliveries`, `earnings`, `verified`, `countries`, `next_trip`, `bio`, `created_at`, `updated_at`, `subscription_status`, `subscription_expires_at`, `terms_accepted`, `terms_accepted_at`) VALUES
('1adebac4-000e-42ed-a504-7db74ccbf980', NULL, NULL, NULL, 0.00, 0, 0, 0.00, 0, NULL, NULL, NULL, '2026-04-01 22:59:27', '2026-04-01 22:59:27', 'none', NULL, 1, '2026-04-01 22:59:27'),
('62ca110b-ed47-4a8f-aeca-156d0e90f636', NULL, NULL, NULL, 0.00, 0, 0, 0.00, 0, NULL, NULL, NULL, '2026-03-22 16:48:23', '2026-03-22 16:48:23', 'none', NULL, 1, '2026-03-22 16:48:23');

-- --------------------------------------------------------

--
-- Structure de la table `transporter_subscriptions`
--

CREATE TABLE `transporter_subscriptions` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `receipt_url` varchar(500) NOT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `amount` decimal(10,2) DEFAULT 2000.00,
  `admin_note` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Structure de la table `transporter_trajectories`
--

CREATE TABLE `transporter_trajectories` (
  `id` varchar(36) NOT NULL,
  `transporter_id` varchar(36) NOT NULL,
  `from_country` varchar(100) NOT NULL,
  `from_city` varchar(100) NOT NULL,
  `to_country` varchar(100) NOT NULL,
  `to_city` varchar(100) NOT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Déchargement des données de la table `transporter_trajectories`
--

INSERT INTO `transporter_trajectories` (`id`, `transporter_id`, `from_country`, `from_city`, `to_country`, `to_city`, `status`, `created_at`) VALUES
('0a4235b5-fef5-491d-92f2-d210de8a8b37', '62ca110b-ed47-4a8f-aeca-156d0e90f636', 'Morocco', 'Rabat', 'Spain', 'Barcelona', 'approved', '2026-03-22 16:48:23'),
('bdd34c1f-ae38-4bb5-86b3-44ea54f5bcbc', '1adebac4-000e-42ed-a504-7db74ccbf980', 'Morocco', 'Casablanca', 'Spain', 'Madrid', 'approved', '2026-04-01 22:59:27');

-- --------------------------------------------------------

--
-- Structure de la table `client_trajectories`
-- A route a client wants served ("request voyage"). Surfaced to transporters.
-- Max 5 per client (enforced in the API layer).
--

CREATE TABLE `client_trajectories` (
  `id` varchar(36) NOT NULL,
  `client_id` varchar(36) NOT NULL,
  `from_country` varchar(100) NOT NULL,
  `from_city` varchar(100) NOT NULL,
  `to_country` varchar(100) NOT NULL,
  `to_city` varchar(100) NOT NULL,
  `status` enum('active','archived') NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_client_traj_client` (`client_id`),
  KEY `idx_client_traj_route` (`from_city`,`to_city`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Structure de la table `users`
--

CREATE TABLE `users` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('client','transporter','admin') NOT NULL,
  `phone` varchar(30) DEFAULT NULL,
  `avatar` varchar(500) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `status` enum('active','pending','suspended','inactive') NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Déchargement des données de la table `users`
--

INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `role`, `phone`, `avatar`, `address`, `status`, `created_at`, `updated_at`) VALUES
('1adebac4-000e-42ed-a504-7db74ccbf980', 'Walid', 'walid@gmail.com', '$2a$10$OZUeSMWmlgRC33df/M.oeeySBoCSWZomkxSFrp14km70Ikk9Ey8n2', 'transporter', '0655332288', NULL, NULL, 'pending', '2026-04-01 22:59:27', '2026-04-01 22:59:27'),
('62ca110b-ed47-4a8f-aeca-156d0e90f636', 'Ali transporteur', 'ali@gmail.com', '$2a$10$G9z809yfXaIKQ2tCKESr.OTpAPs7dBh0XXYfeU8iBmdV9HkUtMylu', 'transporter', '066655332', NULL, NULL, 'active', '2026-03-22 16:48:23', '2026-03-22 16:51:13'),
('dacc459e-e974-482e-8cc0-3bb8eebc5ba7', 'Khadija', 'khadija@gmail.com', '$2a$10$7fYqb.p/Jq/PZZhqDrN91eK8OftKRkdiyJx5geFzzTtkiW3.TeJKW', 'admin', '0645321548', NULL, NULL, 'active', '2026-03-21 21:27:20', '2026-03-22 16:41:04'),
('db274a83-fb8c-4ef1-b4b9-419436a1540d', 'nizar', 'nizar@gmail.com', '$2a$10$no2okrmos8Fs4tY6pWRsGOf8UZCbXjvfbcftPnqH5NNFV3NKK0uBa', 'client', '066655223', NULL, NULL, 'active', '2026-04-01 22:44:31', '2026-04-01 22:44:31');

-- --------------------------------------------------------

--
-- Structure de la table `voyages`
--

CREATE TABLE `voyages` (
  `id` varchar(36) NOT NULL,
  `transporter_id` varchar(36) NOT NULL,
  `from_country` varchar(100) NOT NULL,
  `from_city` varchar(100) NOT NULL,
  `to_country` varchar(100) NOT NULL,
  `to_city` varchar(100) NOT NULL,
  `departure_date` date NOT NULL,
  `estimated_arrival` date NOT NULL,
  `available_capacity` varchar(50) DEFAULT NULL,
  `price_per_kg` decimal(10,2) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `status` enum('upcoming','in_progress','completed','cancelled') NOT NULL DEFAULT 'upcoming',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Index pour les tables déchargées
--

--
-- Index pour la table `deliveries`
--
ALTER TABLE `deliveries`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `tracking_code` (`tracking_code`),
  ADD KEY `fk_del_voyage` (`voyage_id`),
  ADD KEY `idx_del_client` (`client_id`),
  ADD KEY `idx_del_transporter` (`transporter_id`),
  ADD KEY `idx_del_status` (`status`),
  ADD KEY `idx_del_tracking` (`tracking_code`),
  ADD KEY `idx_del_created` (`created_at`);

--
-- Index pour la table `messages`
--
ALTER TABLE `messages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_msg_delivery` (`delivery_id`),
  ADD KEY `idx_msg_sender` (`sender_id`),
  ADD KEY `idx_msg_recipient` (`recipient_id`),
  ADD KEY `idx_msg_delivery_read` (`delivery_id`,`is_read`);

--
-- Index pour la table `notifications`
--
ALTER TABLE `notifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_notif_delivery` (`delivery_id`),
  ADD KEY `idx_notif_user` (`user_id`),
  ADD KEY `idx_notif_user_read` (`user_id`,`is_read`),
  ADD KEY `idx_notif_created` (`created_at`);

--
-- Index pour la table `ratings`
--
ALTER TABLE `ratings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `delivery_id` (`delivery_id`),
  ADD KEY `idx_rating_transporter` (`transporter_id`),
  ADD KEY `idx_rating_client` (`client_id`);

--
-- Index pour la table `reclamations`
--
ALTER TABLE `reclamations`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_rec_client` (`client_id`),
  ADD KEY `idx_rec_delivery` (`delivery_id`),
  ADD KEY `idx_rec_status` (`status`);

--
-- Index pour la table `shipping_routes`
--
ALTER TABLE `shipping_routes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_route_countries` (`from_country`,`to_country`);

--
-- Index pour la table `support_tickets`
--
ALTER TABLE `support_tickets`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_ticket_user` (`user_id`),
  ADD KEY `idx_ticket_status` (`status`);

--
-- Index pour la table `transporter_documents`
--
ALTER TABLE `transporter_documents`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_doc_user` (`user_id`),
  ADD KEY `idx_doc_status` (`status`);

--
-- Index pour la table `transporter_profiles`
--
ALTER TABLE `transporter_profiles`
  ADD PRIMARY KEY (`user_id`);

--
-- Index pour la table `transporter_subscriptions`
--
ALTER TABLE `transporter_subscriptions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`);

--
-- Index pour la table `transporter_trajectories`
--
ALTER TABLE `transporter_trajectories`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_traj_transporter` (`transporter_id`),
  ADD KEY `idx_traj_status` (`status`);

--
-- Index pour la table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `idx_users_email` (`email`),
  ADD KEY `idx_users_role` (`role`),
  ADD KEY `idx_users_status` (`status`);

--
-- Index pour la table `voyages`
--
ALTER TABLE `voyages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_voyage_transporter` (`transporter_id`),
  ADD KEY `idx_voyage_departure` (`departure_date`),
  ADD KEY `idx_voyage_status` (`status`),
  ADD KEY `idx_voyage_route` (`from_country`,`to_country`);

--
-- Contraintes pour les tables déchargées
--

--
-- Contraintes pour la table `deliveries`
--
ALTER TABLE `deliveries`
  ADD CONSTRAINT `fk_del_client` FOREIGN KEY (`client_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_del_transporter` FOREIGN KEY (`transporter_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_del_voyage` FOREIGN KEY (`voyage_id`) REFERENCES `voyages` (`id`) ON DELETE SET NULL;

--
-- Contraintes pour la table `messages`
--
ALTER TABLE `messages`
  ADD CONSTRAINT `fk_msg_delivery` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_msg_recipient` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_msg_sender` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Contraintes pour la table `notifications`
--
ALTER TABLE `notifications`
  ADD CONSTRAINT `fk_notif_delivery` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_notif_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Contraintes pour la table `ratings`
--
ALTER TABLE `ratings`
  ADD CONSTRAINT `fk_rating_client` FOREIGN KEY (`client_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_rating_delivery` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_rating_transporter` FOREIGN KEY (`transporter_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Contraintes pour la table `reclamations`
--
ALTER TABLE `reclamations`
  ADD CONSTRAINT `fk_rec_client` FOREIGN KEY (`client_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_rec_delivery` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`) ON DELETE CASCADE;

--
-- Contraintes pour la table `support_tickets`
--
ALTER TABLE `support_tickets`
  ADD CONSTRAINT `fk_support_tickets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_ticket_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Contraintes pour la table `transporter_documents`
--
ALTER TABLE `transporter_documents`
  ADD CONSTRAINT `fk_doc_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Contraintes pour la table `transporter_profiles`
--
ALTER TABLE `transporter_profiles`
  ADD CONSTRAINT `fk_tp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Contraintes pour la table `transporter_subscriptions`
--
ALTER TABLE `transporter_subscriptions`
  ADD CONSTRAINT `transporter_subscriptions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Contraintes pour la table `transporter_trajectories`
--
ALTER TABLE `transporter_trajectories`
  ADD CONSTRAINT `transporter_trajectories_ibfk_1` FOREIGN KEY (`transporter_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Contraintes pour la table `voyages`
--
ALTER TABLE `voyages`
  ADD CONSTRAINT `fk_voyage_transporter` FOREIGN KEY (`transporter_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
