<?php
/**
 * Scotia Tire & Alignment theme functions.
 *
 * @package Scotia_Tire
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SCOTIA_TIRE_VERSION', '1.0.0' );

/**
 * Theme setup.
 */
function scotia_tire_setup() {
	load_theme_textdomain( 'scotia-tire', get_template_directory() . '/languages' );

	add_theme_support( 'title-tag' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'customize-selective-refresh-widgets' );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'align-wide' );
	add_theme_support(
		'html5',
		array( 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script' )
	);
	add_theme_support(
		'custom-logo',
		array(
			'height'      => 92,
			'width'       => 300,
			'flex-height' => true,
			'flex-width'  => true,
		)
	);

	register_nav_menus(
		array(
			'primary' => __( 'Primary Menu', 'scotia-tire' ),
			'footer'  => __( 'Footer Menu', 'scotia-tire' ),
		)
	);

	// WooCommerce.
	add_theme_support(
		'woocommerce',
		array(
			'thumbnail_image_width' => 600,
			'single_image_width'    => 900,
			'product_grid'          => array(
				'default_columns' => 3,
				'min_columns'     => 2,
				'max_columns'     => 4,
			),
		)
	);
	add_theme_support( 'wc-product-gallery-zoom' );
	add_theme_support( 'wc-product-gallery-lightbox' );
	add_theme_support( 'wc-product-gallery-slider' );
}
add_action( 'after_setup_theme', 'scotia_tire_setup' );

/**
 * Enqueue scripts and styles.
 */
function scotia_tire_scripts() {
	wp_enqueue_style( 'scotia-tire-style', get_stylesheet_uri(), array(), SCOTIA_TIRE_VERSION );
	wp_enqueue_script( 'scotia-tire-main', get_template_directory_uri() . '/assets/js/main.js', array(), SCOTIA_TIRE_VERSION, true );
}
add_action( 'wp_enqueue_scripts', 'scotia_tire_scripts' );

/**
 * Widget areas.
 */
function scotia_tire_widgets_init() {
	for ( $i = 1; $i <= 3; $i++ ) {
		register_sidebar(
			array(
				/* translators: %d: footer column number. */
				'name'          => sprintf( __( 'Footer Column %d', 'scotia-tire' ), $i ),
				'id'            => 'footer-' . $i,
				'description'   => __( 'Appears in the site footer.', 'scotia-tire' ),
				'before_widget' => '<div id="%1$s" class="widget %2$s">',
				'after_widget'  => '</div>',
				'before_title'  => '<h4 class="widget-title">',
				'after_title'   => '</h4>',
			)
		);
	}
}
add_action( 'widgets_init', 'scotia_tire_widgets_init' );

/**
 * Whether WooCommerce is active.
 *
 * @return bool
 */
function scotia_tire_is_woocommerce_active() {
	return class_exists( 'WooCommerce' );
}

/* --------------------------------------------------------------------------
 * Customizer
 * ------------------------------------------------------------------------ */

/**
 * Register Customizer settings for business details.
 *
 * @param WP_Customize_Manager $wp_customize Customizer manager.
 */
function scotia_tire_customize_register( $wp_customize ) {
	$wp_customize->add_section(
		'scotia_tire_business',
		array(
			'title'    => __( 'Business Details', 'scotia-tire' ),
			'priority' => 30,
		)
	);

	$fields = array(
		'scotia_tire_phone'    => array(
			'label'   => __( 'Phone Number', 'scotia-tire' ),
			'default' => '',
		),
		'scotia_tire_address'  => array(
			'label'   => __( 'Shop Address', 'scotia-tire' ),
			'default' => __( 'Shop & walk-ins: McAdam Rd — mobile service available anywhere in the GTA', 'scotia-tire' ),
		),
		'scotia_tire_hours'    => array(
			'label'   => __( 'Hours / Availability', 'scotia-tire' ),
			'default' => __( '24/7 emergency dispatch available', 'scotia-tire' ),
		),
		'scotia_tire_tagline'  => array(
			'label'   => __( 'Brand Sub-line', 'scotia-tire' ),
			'default' => __( 'Commercial · Fleet · Trailer Services', 'scotia-tire' ),
		),
		'scotia_tire_disclaim' => array(
			'label'   => __( 'Footer Fine Print', 'scotia-tire' ),
			'default' => __( 'Prices in CAD, subject to change without notice. Parts and applicable taxes are additional unless stated.', 'scotia-tire' ),
		),
	);

	foreach ( $fields as $id => $field ) {
		$wp_customize->add_setting(
			$id,
			array(
				'default'           => $field['default'],
				'sanitize_callback' => 'sanitize_text_field',
			)
		);
		$wp_customize->add_control(
			$id,
			array(
				'label'   => $field['label'],
				'section' => 'scotia_tire_business',
				'type'    => 'text',
			)
		);
	}
}
add_action( 'customize_register', 'scotia_tire_customize_register' );

/**
 * Get a business detail with its default fallback.
 *
 * @param string $key Setting key.
 * @return string
 */
function scotia_tire_get_option( $key ) {
	$defaults = array(
		'scotia_tire_phone'    => '',
		'scotia_tire_address'  => __( 'Shop & walk-ins: McAdam Rd — mobile service available anywhere in the GTA', 'scotia-tire' ),
		'scotia_tire_hours'    => __( '24/7 emergency dispatch available', 'scotia-tire' ),
		'scotia_tire_tagline'  => __( 'Commercial · Fleet · Trailer Services', 'scotia-tire' ),
		'scotia_tire_disclaim' => __( 'Prices in CAD, subject to change without notice. Parts and applicable taxes are additional unless stated.', 'scotia-tire' ),
	);
	$default  = isset( $defaults[ $key ] ) ? $defaults[ $key ] : '';

	return get_theme_mod( $key, $default );
}

/* --------------------------------------------------------------------------
 * WooCommerce integration
 * ------------------------------------------------------------------------ */

if ( scotia_tire_is_woocommerce_active() ) {

	// Replace WooCommerce content wrappers with the theme's own.
	remove_action( 'woocommerce_before_main_content', 'woocommerce_output_content_wrapper', 10 );
	remove_action( 'woocommerce_after_main_content', 'woocommerce_output_content_wrapper_end', 10 );
	remove_action( 'woocommerce_sidebar', 'woocommerce_get_sidebar', 10 );

	add_action(
		'woocommerce_before_main_content',
		function () {
			echo '<main id="primary" class="st-main st-main--woo"><div class="st-container">';
		},
		10
	);
	add_action(
		'woocommerce_after_main_content',
		function () {
			echo '</div></main>';
		},
		10
	);

	// Wrap the loop item text so cards can flex.
	add_action(
		'woocommerce_before_shop_loop_item_title',
		function () {
			echo '<div class="st-product-body">';
		},
		20
	);
	add_action(
		'woocommerce_after_shop_loop_item',
		function () {
			echo '</div>';
		},
		20
	);

	/**
	 * Refresh the header cart count fragment via AJAX.
	 *
	 * @param array $fragments Cart fragments.
	 * @return array
	 */
	function scotia_tire_cart_fragment( $fragments ) {
		$count = WC()->cart ? WC()->cart->get_cart_contents_count() : 0;

		$fragments['span.st-cart-count'] = '<span class="st-cart-count">' . esc_html( number_format_i18n( $count ) ) . '</span>';

		return $fragments;
	}
	add_filter( 'woocommerce_add_to_cart_fragments', 'scotia_tire_cart_fragment' );
}

/**
 * Output the header cart link.
 */
function scotia_tire_header_cart() {
	if ( ! scotia_tire_is_woocommerce_active() ) {
		return;
	}

	$count = WC()->cart ? WC()->cart->get_cart_contents_count() : 0;
	?>
	<a class="st-cart-link" href="<?php echo esc_url( wc_get_cart_url() ); ?>" aria-label="<?php esc_attr_e( 'View your shopping cart', 'scotia-tire' ); ?>">
		<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/><path d="M2.5 3.5h3l2.6 12h10.4l2-8.5H6.2"/></svg>
		<span class="st-cart-count"><?php echo esc_html( number_format_i18n( $count ) ); ?></span>
	</a>
	<?php
}

/**
 * Output the brand tire-wheel SVG mark.
 */
function scotia_tire_brand_mark_svg() {
	?>
	<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>
	<?php
}

/**
 * Fallback menu when no primary menu is assigned.
 */
function scotia_tire_fallback_menu() {
	echo '<ul>';
	echo '<li><a href="' . esc_url( home_url( '/' ) ) . '">' . esc_html__( 'Home', 'scotia-tire' ) . '</a></li>';

	if ( scotia_tire_is_woocommerce_active() ) {
		$shop_id = wc_get_page_id( 'shop' );
		if ( $shop_id > 0 ) {
			echo '<li><a href="' . esc_url( get_permalink( $shop_id ) ) . '">' . esc_html__( 'Services & Shop', 'scotia-tire' ) . '</a></li>';
		}
	}

	echo '</ul>';
}
