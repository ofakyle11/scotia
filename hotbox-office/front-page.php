<?php
/**
 * Front page template.
 *
 * Recreates the Hotbox Office landing page as a live storefront:
 * hero with wordmark panel and stats, shop grid with category chips,
 * trust strip, reviews, FAQ, and visit section.
 *
 * @package Hotbox_Office
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

get_header();

$hotbox_shop_url = hotbox_office_is_wc_active() ? get_permalink( wc_get_page_id( 'shop' ) ) : home_url( '/' );
?>

<main id="primary">

	<!-- Hero -->
	<div class="hb-wrap hb-hero">
		<div class="hb-hero__grid">
			<div>
				<span class="hb-eyebrow"><?php echo esc_html( hotbox_office_get_option( 'hotbox_hero_kicker' ) ); ?></span>
				<h1><?php esc_html_e( 'Elevate your mind.', 'hotbox-office' ); ?></h1>
				<p class="hb-lede"><?php esc_html_e( 'Supplements, mushroom coffee, grow-your-own kits, and gourmet dried fungi — grown in Canada, third-party tested, and shipped fast. No psilocybin, no gimmicks, just good mushrooms.', 'hotbox-office' ); ?></p>
				<div class="hb-cta-row">
					<a class="hb-btn" href="<?php echo esc_url( $hotbox_shop_url ); ?>"><?php esc_html_e( 'Shop best sellers', 'hotbox-office' ); ?></a>
					<a class="hb-btn hb-btn--ghost" href="#faq"><?php esc_html_e( 'New to functional mushrooms?', 'hotbox-office' ); ?></a>
				</div>
				<div class="hb-stats">
					<div class="hb-stat"><b>4.9★</b><span><?php esc_html_e( '1,200+ reviews', 'hotbox-office' ); ?></span></div>
					<div class="hb-stat"><b>48 h</b><span><?php esc_html_e( 'average delivery', 'hotbox-office' ); ?></span></div>
					<div class="hb-stat"><b>100%</b><span><?php esc_html_e( 'third-party tested', 'hotbox-office' ); ?></span></div>
				</div>
			</div>
			<div class="hb-hero__panel">
				<svg viewBox="0 0 340 318" role="img" aria-label="<?php echo esc_attr( get_bloginfo( 'name' ) ); ?>" font-family="Futura,'Avenir Next',Montserrat,'Segoe UI',system-ui,sans-serif">
					<use href="#hb-mark" transform="translate(126,6) scale(.88)"></use>
					<text x="170" y="164" text-anchor="middle" font-size="43" font-weight="800" letter-spacing="8" fill="url(#hb-champagne)">HOTBOX</text>
					<line x1="42" y1="192" x2="104" y2="192" stroke="#8CB35A" stroke-width="2"/>
					<line x1="236" y1="192" x2="298" y2="192" stroke="#8CB35A" stroke-width="2"/>
					<text x="170" y="199" text-anchor="middle" font-size="21" font-weight="600" letter-spacing="12" fill="#8CB35A">OFFICE</text>
					<text x="170" y="242" text-anchor="middle" font-size="13.5" font-weight="600" letter-spacing="3.6" fill="#EDE6D3">CANNABIS &amp; MUSHROOM STORE</text>
					<text x="170" y="274" text-anchor="middle" font-size="11.5" font-weight="600" letter-spacing="5.5" fill="#8CB35A">ELEVATE YOUR MIND</text>
				</svg>
			</div>
		</div>
	</div>

	<!-- Shop -->
	<section id="shop" class="hb-section">
		<div class="hb-wrap">
			<div class="hb-section__head">
				<div>
					<span class="hb-eyebrow"><?php esc_html_e( 'The shop', 'hotbox-office' ); ?></span>
					<h2><?php esc_html_e( 'Everything a mushroom person needs', 'hotbox-office' ); ?></h2>
					<p><?php esc_html_e( 'Filter by category, or browse the whole shelf. Every batch is third-party lab tested for purity and identity.', 'hotbox-office' ); ?></p>
				</div>
				<?php if ( hotbox_office_is_wc_active() ) : ?>
					<a class="hb-more" href="<?php echo esc_url( $hotbox_shop_url ); ?>"><?php esc_html_e( 'View the full shelf →', 'hotbox-office' ); ?></a>
				<?php endif; ?>
			</div>

			<?php
			$hotbox_products = array();
			if ( hotbox_office_is_wc_active() ) {
				hotbox_office_category_chips();

				$hotbox_products = wc_get_products(
					array(
						'status'     => 'publish',
						'limit'      => 8,
						'featured'   => true,
						'visibility' => 'catalog',
					)
				);
				if ( empty( $hotbox_products ) ) {
					$hotbox_products = wc_get_products(
						array(
							'status'     => 'publish',
							'limit'      => 8,
							'orderby'    => 'date',
							'order'      => 'DESC',
							'visibility' => 'catalog',
						)
					);
				}
			}
			?>

			<?php if ( ! empty( $hotbox_products ) ) : ?>
				<div class="hb-grid">
					<?php foreach ( $hotbox_products as $hotbox_product ) : ?>
						<article class="hb-card">
							<a class="hb-card__art" href="<?php echo esc_url( $hotbox_product->get_permalink() ); ?>">
								<?php if ( $hotbox_product->is_on_sale() ) : ?>
									<span class="hb-badge"><?php esc_html_e( 'Sale', 'hotbox-office' ); ?></span>
								<?php elseif ( $hotbox_product->is_featured() ) : ?>
									<span class="hb-badge"><?php esc_html_e( 'Best seller', 'hotbox-office' ); ?></span>
								<?php endif; ?>
								<?php if ( $hotbox_product->get_image_id() ) : ?>
									<?php echo wp_get_attachment_image( $hotbox_product->get_image_id(), 'woocommerce_thumbnail' ); ?>
								<?php else : ?>
									<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><use href="#shroom" fill="#9FC272"></use></svg>
								<?php endif; ?>
							</a>
							<div class="hb-card__body">
								<?php
								$hotbox_cats = wc_get_product_category_list( $hotbox_product->get_id(), ', ' );
								if ( $hotbox_cats ) :
									?>
									<span class="hb-card__cat"><?php echo esc_html( wp_strip_all_tags( $hotbox_cats ) ); ?></span>
								<?php endif; ?>
								<h3 class="hb-card__name"><a href="<?php echo esc_url( $hotbox_product->get_permalink() ); ?>"><?php echo esc_html( $hotbox_product->get_name() ); ?></a></h3>
								<p class="hb-card__desc"><?php echo esc_html( wp_trim_words( wp_strip_all_tags( $hotbox_product->get_short_description() ? $hotbox_product->get_short_description() : $hotbox_product->get_description() ), 20 ) ); ?></p>
								<div class="hb-card__foot">
									<span class="hb-card__price price"><?php echo wp_kses_post( $hotbox_product->get_price_html() ); ?></span>
									<?php if ( $hotbox_product->is_type( 'simple' ) && $hotbox_product->is_purchasable() && $hotbox_product->is_in_stock() ) : ?>
										<a class="hb-add-btn" href="<?php echo esc_url( $hotbox_product->add_to_cart_url() ); ?>"><?php esc_html_e( 'Add to cart', 'hotbox-office' ); ?></a>
									<?php else : ?>
										<a class="hb-add-btn" href="<?php echo esc_url( $hotbox_product->get_permalink() ); ?>"><?php esc_html_e( 'View', 'hotbox-office' ); ?></a>
									<?php endif; ?>
								</div>
							</div>
						</article>
					<?php endforeach; ?>
				</div>
			<?php else : ?>
				<?php get_template_part( 'template-parts/products', 'static' ); ?>
			<?php endif; ?>
		</div>
	</section>

	<!-- Trust -->
	<section id="why" class="hb-section hb-trust">
		<div class="hb-wrap">
			<div class="hb-section__head">
				<div>
					<span class="hb-eyebrow"><?php esc_html_e( 'Why Hotbox Office', 'hotbox-office' ); ?></span>
					<h2><?php esc_html_e( 'Grown with patience, tested with rigour', 'hotbox-office' ); ?></h2>
				</div>
			</div>
			<div class="hb-trust__grid">
				<div class="hb-trust__item">
					<div class="hb-glyph">✓</div>
					<h3><?php esc_html_e( 'Third-party lab tested', 'hotbox-office' ); ?></h3>
					<p><?php esc_html_e( 'Every lot is verified for species identity, beta-glucans, and contaminants. Certificates available on request.', 'hotbox-office' ); ?></p>
				</div>
				<div class="hb-trust__item">
					<div class="hb-glyph">⚘</div>
					<h3><?php esc_html_e( 'Fruiting body only', 'hotbox-office' ); ?></h3>
					<p><?php esc_html_e( 'No grain filler, no mycelium-on-oats. Our extracts use 100% fruiting bodies for full-spectrum compounds.', 'hotbox-office' ); ?></p>
				</div>
				<div class="hb-trust__item">
					<div class="hb-glyph">⇥</div>
					<h3><?php esc_html_e( 'Fast, discreet shipping', 'hotbox-office' ); ?></h3>
					<p><?php esc_html_e( 'Orders ship within 24 hours from our Nova Scotia facility. Same-day courier available locally.', 'hotbox-office' ); ?></p>
				</div>
				<div class="hb-trust__item">
					<div class="hb-glyph">↺</div>
					<h3><?php esc_html_e( '30-day guarantee', 'hotbox-office' ); ?></h3>
					<p><?php esc_html_e( 'Not feeling it? Send back any product within 30 days — opened or not — for a full refund.', 'hotbox-office' ); ?></p>
				</div>
			</div>
		</div>
	</section>

	<!-- Reviews -->
	<section id="reviews" class="hb-section">
		<div class="hb-wrap">
			<div class="hb-section__head">
				<div>
					<span class="hb-eyebrow"><?php esc_html_e( 'Reviews', 'hotbox-office' ); ?></span>
					<h2><?php esc_html_e( '1,200+ happy mushroom people', 'hotbox-office' ); ?></h2>
				</div>
			</div>
			<div class="hb-reviews__grid">
				<div class="hb-review">
					<div class="hb-stars" aria-label="<?php esc_attr_e( '5 out of 5 stars', 'hotbox-office' ); ?>">★★★★★</div>
					<p><?php esc_html_e( '"The lion\'s mane capsules are now part of my morning routine. Noticeable difference in focus by week two."', 'hotbox-office' ); ?></p>
					<div class="hb-who"><?php esc_html_e( 'Sarah M. — Halifax, NS', 'hotbox-office' ); ?></div>
				</div>
				<div class="hb-review">
					<div class="hb-stars" aria-label="<?php esc_attr_e( '5 out of 5 stars', 'hotbox-office' ); ?>">★★★★★</div>
					<p><?php esc_html_e( '"Bought the oyster grow kit for my kids as a science project. We harvested twice — dinner never looked cooler."', 'hotbox-office' ); ?></p>
					<div class="hb-who"><?php esc_html_e( 'Devon R. — Dartmouth, NS', 'hotbox-office' ); ?></div>
				</div>
				<div class="hb-review">
					<div class="hb-stars" aria-label="<?php esc_attr_e( '5 out of 5 stars', 'hotbox-office' ); ?>">★★★★★</div>
					<p><?php esc_html_e( '"Mushroom coffee that actually tastes like coffee. Smooth energy, no jitters, no crash at 2 pm."', 'hotbox-office' ); ?></p>
					<div class="hb-who"><?php esc_html_e( 'Priya K. — Moncton, NB', 'hotbox-office' ); ?></div>
				</div>
				<div class="hb-review">
					<div class="hb-stars" aria-label="<?php esc_attr_e( '5 out of 5 stars', 'hotbox-office' ); ?>">★★★★★</div>
					<p><?php esc_html_e( '"Ordered Tuesday, arrived Thursday. The dried porcini turned a basic risotto into the best thing I\'ve cooked all year."', 'hotbox-office' ); ?></p>
					<div class="hb-who"><?php esc_html_e( 'Marc L. — Charlottetown, PE', 'hotbox-office' ); ?></div>
				</div>
			</div>
		</div>
	</section>

	<!-- FAQ -->
	<section id="faq" class="hb-section">
		<div class="hb-wrap">
			<div class="hb-section__head">
				<div>
					<span class="hb-eyebrow"><?php esc_html_e( 'FAQ', 'hotbox-office' ); ?></span>
					<h2><?php esc_html_e( 'Good questions, straight answers', 'hotbox-office' ); ?></h2>
				</div>
			</div>
			<div class="hb-faq">
				<details>
					<summary><?php esc_html_e( 'What are functional mushrooms?', 'hotbox-office' ); ?></summary>
					<p><?php esc_html_e( 'Functional mushrooms — like lion\'s mane, reishi, cordyceps, chaga, and turkey tail — are culinary and traditional-wellness species valued for compounds such as beta-glucans. They\'re consumed as supplements, teas, coffees, and food.', 'hotbox-office' ); ?></p>
				</details>
				<details>
					<summary><?php esc_html_e( 'Do your products contain psilocybin?', 'hotbox-office' ); ?></summary>
					<p><?php esc_html_e( 'No. Nothing we sell contains psilocybin or any controlled substance. Every product is 100% legal to buy, own, and use in Canada, and every batch is lab-tested to verify exactly what\'s inside.', 'hotbox-office' ); ?></p>
				</details>
				<details>
					<summary><?php esc_html_e( 'How hard are the grow kits, really?', 'hotbox-office' ); ?></summary>
					<p><?php esc_html_e( 'Easy. Cut, mist twice a day, and harvest in 10–14 days. Kits include everything except the spray bottle, and most produce two to three flushes. If a kit doesn\'t fruit, we replace it free.', 'hotbox-office' ); ?></p>
				</details>
				<details>
					<summary><?php esc_html_e( 'How does delivery work?', 'hotbox-office' ); ?></summary>
					<p><?php esc_html_e( 'Delivery orders have a $149 minimum — and every order that reaches it automatically gets 15% off everything. Orders placed before 2 pm Atlantic go out the same day: same-day courier across HRM, 1–2 days for most of the Maritimes, 2–5 for the rest of Canada.', 'hotbox-office' ); ?></p>
				</details>
				<details>
					<summary><?php esc_html_e( 'How do I pay?', 'hotbox-office' ); ?></summary>
					<p><?php esc_html_e( 'Two ways: Interac e-transfer — place your order, then send the total to the address shown on your confirmation with your order number in the message — or cash on delivery, paid to the driver when your order arrives. No card needed.', 'hotbox-office' ); ?></p>
				</details>
				<details>
					<summary><?php esc_html_e( 'Can I take functional mushrooms with my medication?', 'hotbox-office' ); ?></summary>
					<p><?php esc_html_e( 'Talk to your doctor or pharmacist first — especially if you\'re pregnant, nursing, immunocompromised, or on blood thinners. We\'re mushroom people, not medical professionals.', 'hotbox-office' ); ?></p>
				</details>
			</div>
		</div>
	</section>

	<!-- Visit -->
	<section id="visit" class="hb-section">
		<div class="hb-wrap">
			<div class="hb-section__head">
				<div>
					<span class="hb-eyebrow"><?php esc_html_e( 'Visit us', 'hotbox-office' ); ?></span>
					<h2><?php esc_html_e( 'Come smell the shiitake', 'hotbox-office' ); ?></h2>
				</div>
			</div>
			<div class="hb-visit__grid">
				<div class="hb-visit__card">
					<h3><?php bloginfo( 'name' ); ?></h3>
					<p><?php echo esc_html( hotbox_office_get_option( 'hotbox_address' ) ); ?></p>
					<p><?php echo esc_html( hotbox_office_get_option( 'hotbox_phone' ) ); ?> · <?php echo esc_html( hotbox_office_get_option( 'hotbox_email' ) ); ?></p>
					<table class="hb-hours">
						<tr><td><?php esc_html_e( 'Monday – Friday', 'hotbox-office' ); ?></td><td><?php echo esc_html( hotbox_office_get_option( 'hotbox_hours_wk' ) ); ?></td></tr>
						<tr><td><?php esc_html_e( 'Saturday', 'hotbox-office' ); ?></td><td><?php echo esc_html( hotbox_office_get_option( 'hotbox_hours_sat' ) ); ?></td></tr>
						<tr><td><?php esc_html_e( 'Sunday', 'hotbox-office' ); ?></td><td><?php echo esc_html( hotbox_office_get_option( 'hotbox_hours_sun' ) ); ?></td></tr>
					</table>
				</div>
				<div class="hb-visit__card">
					<h3><?php esc_html_e( 'Questions? Talk to a human.', 'hotbox-office' ); ?></h3>
					<p><?php esc_html_e( 'Our team answers email within one business day and can help with dosing schedules, grow-kit troubleshooting, and wholesale orders.', 'hotbox-office' ); ?></p>
					<p style="margin-top:14px"><a class="hb-btn" href="<?php echo esc_url( 'mailto:' . hotbox_office_get_option( 'hotbox_email' ) ); ?>"><?php esc_html_e( 'Email us', 'hotbox-office' ); ?></a></p>
				</div>
			</div>
		</div>
	</section>

	<?php
	// Optional editable page content below the built-in sections.
	while ( have_posts() ) :
		the_post();
		$hotbox_content = get_the_content();
		if ( trim( $hotbox_content ) ) :
			?>
			<section class="hb-section">
				<div class="hb-wrap hb-entry hb-post__content">
					<?php the_content(); ?>
				</div>
			</section>
			<?php
		endif;
	endwhile;
	?>

</main>

<?php
get_footer();
