<?php
/**
 * Static product grid — shown on the front page until WooCommerce
 * products exist. Mirrors the original Hotbox Office catalog.
 *
 * @package Hotbox_Office
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$hotbox_items = array(
	array(
		'name'  => __( "Lion's Mane Focus Capsules", 'hotbox-office' ),
		'cat'   => __( 'Supplements', 'hotbox-office' ),
		'price' => '$34.99',
		'desc'  => __( '120 capsules · 1000 mg fruiting-body extract for focus and memory.', 'hotbox-office' ),
		'tint'  => '#1B2314',
		'color' => '#9FC272',
		'badge' => __( 'Best seller', 'hotbox-office' ),
	),
	array(
		'name'  => __( 'Reishi Calm Tincture', 'hotbox-office' ),
		'cat'   => __( 'Supplements', 'hotbox-office' ),
		'price' => '$29.99',
		'desc'  => __( '60 ml dual-extract tincture for evening wind-down and rest.', 'hotbox-office' ),
		'tint'  => '#231A20',
		'color' => '#C79BAF',
		'badge' => '',
	),
	array(
		'name'  => __( 'Cordyceps Energy Powder', 'hotbox-office' ),
		'cat'   => __( 'Supplements', 'hotbox-office' ),
		'price' => '$27.99',
		'desc'  => __( '100 g pure cordyceps militaris powder — pre-workout, no caffeine.', 'hotbox-office' ),
		'tint'  => '#251F10',
		'color' => '#D9B36A',
		'badge' => '',
	),
	array(
		'name'  => __( 'Turkey Tail Immunity Capsules', 'hotbox-office' ),
		'cat'   => __( 'Supplements', 'hotbox-office' ),
		'price' => '$32.99',
		'desc'  => __( '90 capsules · beta-glucan-rich extract for immune support.', 'hotbox-office' ),
		'tint'  => '#172025',
		'color' => '#8FB4C6',
		'badge' => '',
	),
	array(
		'name'  => __( '10-Mushroom Complex Gummies', 'hotbox-office' ),
		'cat'   => __( 'Supplements', 'hotbox-office' ),
		'price' => '$28.99',
		'desc'  => __( '60 berry gummies blending ten functional species in one chew.', 'hotbox-office' ),
		'tint'  => '#201A24',
		'color' => '#B99BC7',
		'badge' => __( 'New', 'hotbox-office' ),
	),
	array(
		'name'  => __( 'Chaga Chai Tea', 'hotbox-office' ),
		'cat'   => __( 'Coffee & Pantry', 'hotbox-office' ),
		'price' => '$19.99',
		'desc'  => __( '20 bags of wild-harvested chaga blended with warming chai spice.', 'hotbox-office' ),
		'tint'  => '#241E14',
		'color' => '#C4A176',
		'badge' => '',
	),
	array(
		'name'  => __( 'Mushroom Coffee Blend', 'hotbox-office' ),
		'cat'   => __( 'Coffee & Pantry', 'hotbox-office' ),
		'price' => '$24.99',
		'desc'  => __( "340 g dark roast with lion's mane & chaga. Tastes like coffee.", 'hotbox-office' ),
		'tint'  => '#201A13',
		'color' => '#B59B82',
		'badge' => __( 'Best seller', 'hotbox-office' ),
	),
	array(
		'name'  => __( 'Reishi Hot Cocoa', 'hotbox-office' ),
		'cat'   => __( 'Coffee & Pantry', 'hotbox-office' ),
		'price' => '$21.99',
		'desc'  => __( '250 g rich cocoa with reishi extract — the calmest nightcap.', 'hotbox-office' ),
		'tint'  => '#241712',
		'color' => '#C79484',
		'badge' => '',
	),
	array(
		'name'  => __( 'Pink Oyster Grow Kit', 'hotbox-office' ),
		'cat'   => __( 'Grow Kits', 'hotbox-office' ),
		'price' => '$39.99',
		'desc'  => __( 'Cut, mist, harvest in 10 days. Two to three flushes per block.', 'hotbox-office' ),
		'tint'  => '#261318',
		'color' => '#DB8FA1',
		'badge' => __( 'Staff pick', 'hotbox-office' ),
	),
	array(
		'name'  => __( 'Shiitake Grow Kit', 'hotbox-office' ),
		'cat'   => __( 'Grow Kits', 'hotbox-office' ),
		'price' => '$36.99',
		'desc'  => __( 'Fruits rich, meaty shiitake on a hardwood block. Beginner-proof.', 'hotbox-office' ),
		'tint'  => '#221D12',
		'color' => '#C0AC77',
		'badge' => '',
	),
	array(
		'name'  => __( 'Dried Porcini', 'hotbox-office' ),
		'cat'   => __( 'Gourmet Dried', 'hotbox-office' ),
		'price' => '$18.99',
		'desc'  => __( '50 g of grade-A porcini. Rehydrate for risotto, pasta, and broth.', 'hotbox-office' ),
		'tint'  => '#231F12',
		'color' => '#CDB584',
		'badge' => '',
	),
	array(
		'name'  => __( 'Shiitake & Oyster Medley', 'hotbox-office' ),
		'cat'   => __( 'Gourmet Dried', 'hotbox-office' ),
		'price' => '$16.99',
		'desc'  => __( '100 g mixed dried mushrooms — a pantry staple for instant umami.', 'hotbox-office' ),
		'tint'  => '#1B2015',
		'color' => '#A9B89B',
		'badge' => '',
	),
);
?>

<div class="hb-grid">
	<?php foreach ( $hotbox_items as $hotbox_item ) : ?>
		<article class="hb-card">
			<div class="hb-card__art" style="background:<?php echo esc_attr( $hotbox_item['tint'] ); ?>">
				<?php if ( $hotbox_item['badge'] ) : ?>
					<span class="hb-badge"><?php echo esc_html( $hotbox_item['badge'] ); ?></span>
				<?php endif; ?>
				<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><use href="#shroom" fill="<?php echo esc_attr( $hotbox_item['color'] ); ?>"></use></svg>
			</div>
			<div class="hb-card__body">
				<span class="hb-card__cat"><?php echo esc_html( $hotbox_item['cat'] ); ?></span>
				<h3 class="hb-card__name"><?php echo esc_html( $hotbox_item['name'] ); ?></h3>
				<p class="hb-card__desc"><?php echo esc_html( $hotbox_item['desc'] ); ?></p>
				<div class="hb-card__foot">
					<span class="hb-card__price price"><?php echo esc_html( $hotbox_item['price'] ); ?></span>
					<span class="hb-add-btn"><?php esc_html_e( 'Coming soon', 'hotbox-office' ); ?></span>
				</div>
			</div>
		</article>
	<?php endforeach; ?>
</div>
