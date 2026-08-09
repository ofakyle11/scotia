<?php
/**
 * Hotbox Office theme functions.
 *
 * @package Hotbox_Office
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'HOTBOX_OFFICE_VERSION', '1.2.0' );

/**
 * Theme setup.
 */
function hotbox_office_setup() {
	load_theme_textdomain( 'hotbox-office', get_template_directory() . '/languages' );

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
			'height'      => 88,
			'width'       => 300,
			'flex-height' => true,
			'flex-width'  => true,
		)
	);

	register_nav_menus(
		array(
			'primary' => __( 'Primary Menu', 'hotbox-office' ),
			'footer'  => __( 'Footer Menu', 'hotbox-office' ),
		)
	);

	// WooCommerce.
	add_theme_support(
		'woocommerce',
		array(
			'thumbnail_image_width' => 600,
			'single_image_width'    => 900,
			'product_grid'          => array(
				'default_columns' => 4,
				'min_columns'     => 2,
				'max_columns'     => 4,
			),
		)
	);
	add_theme_support( 'wc-product-gallery-zoom' );
	add_theme_support( 'wc-product-gallery-lightbox' );
	add_theme_support( 'wc-product-gallery-slider' );
}
add_action( 'after_setup_theme', 'hotbox_office_setup' );

/**
 * Enqueue scripts and styles.
 */
function hotbox_office_scripts() {
	wp_enqueue_style( 'hotbox-office-style', get_stylesheet_uri(), array(), HOTBOX_OFFICE_VERSION );
	wp_enqueue_script( 'hotbox-office-main', get_template_directory_uri() . '/assets/js/main.js', array(), HOTBOX_OFFICE_VERSION, true );
}
add_action( 'wp_enqueue_scripts', 'hotbox_office_scripts' );

/**
 * Widget areas.
 */
function hotbox_office_widgets_init() {
	for ( $i = 1; $i <= 3; $i++ ) {
		register_sidebar(
			array(
				/* translators: %d: footer column number. */
				'name'          => sprintf( __( 'Footer Column %d', 'hotbox-office' ), $i ),
				'id'            => 'footer-' . $i,
				'description'   => __( 'Appears in the site footer.', 'hotbox-office' ),
				'before_widget' => '<div id="%1$s" class="widget %2$s">',
				'after_widget'  => '</div>',
				'before_title'  => '<h4 class="widget-title">',
				'after_title'   => '</h4>',
			)
		);
	}
}
add_action( 'widgets_init', 'hotbox_office_widgets_init' );

/**
 * Whether WooCommerce is active.
 *
 * @return bool
 */
function hotbox_office_is_wc_active() {
	return class_exists( 'WooCommerce' );
}

/* --------------------------------------------------------------------------
 * Customizer
 * ------------------------------------------------------------------------ */

/**
 * Register Customizer settings for store details.
 *
 * @param WP_Customize_Manager $wp_customize Customizer manager.
 */
function hotbox_office_customize_register( $wp_customize ) {
	$wp_customize->add_section(
		'hotbox_office_store',
		array(
			'title'    => __( 'Store Details', 'hotbox-office' ),
			'priority' => 30,
		)
	);

	$wp_customize->add_setting(
		'hotbox_scheme',
		array(
			'default'           => 'light',
			'sanitize_callback' => 'hotbox_office_sanitize_scheme',
		)
	);
	$wp_customize->add_control(
		'hotbox_scheme',
		array(
			'label'   => __( 'Color Scheme', 'hotbox-office' ),
			'section' => 'hotbox_office_store',
			'type'    => 'radio',
			'choices' => array(
				'dark'  => __( 'Dark (black & champagne)', 'hotbox-office' ),
				'light' => __( 'Light (white & greenhouse green)', 'hotbox-office' ),
			),
		)
	);

	foreach ( hotbox_office_option_defaults() as $id => $field ) {
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
				'section' => 'hotbox_office_store',
				'type'    => 'text',
			)
		);
	}
}
add_action( 'customize_register', 'hotbox_office_customize_register' );

/**
 * Sanitize the color-scheme choice.
 *
 * @param string $value Raw value.
 * @return string
 */
function hotbox_office_sanitize_scheme( $value ) {
	return in_array( $value, array( 'dark', 'light' ), true ) ? $value : 'light';
}

/**
 * Add the light-scheme body class when selected.
 *
 * @param array $classes Body classes.
 * @return array
 */
function hotbox_office_body_class( $classes ) {
	if ( 'light' === get_theme_mod( 'hotbox_scheme', 'light' ) ) {
		$classes[] = 'hb-light';
	}

	return $classes;
}
add_filter( 'body_class', 'hotbox_office_body_class' );

/**
 * Customizer field definitions and defaults.
 *
 * @return array
 */
function hotbox_office_option_defaults() {
	return array(
		'hotbox_announce'   => array(
			'label'   => __( 'Announcement Bar Text', 'hotbox-office' ),
			'default' => __( 'Same-day delivery in HRM · $149 delivery minimum · 15% off everything on orders over $149', 'hotbox-office' ),
		),
		'hotbox_tagline'    => array(
			'label'   => __( 'Logo Sub-line', 'hotbox-office' ),
			'default' => __( 'Office', 'hotbox-office' ),
		),
		'hotbox_hero_kicker' => array(
			'label'   => __( 'Hero Kicker', 'hotbox-office' ),
			'default' => __( 'Cannabis & Mushroom Store · Halifax, NS', 'hotbox-office' ),
		),
		'hotbox_address'    => array(
			'label'   => __( 'Store Address', 'hotbox-office' ),
			'default' => __( '123 Agricola Street, Halifax, NS', 'hotbox-office' ),
		),
		'hotbox_phone'      => array(
			'label'   => __( 'Phone Number', 'hotbox-office' ),
			'default' => __( '(902) 555-0142', 'hotbox-office' ),
		),
		'hotbox_email'      => array(
			'label'   => __( 'Contact Email', 'hotbox-office' ),
			'default' => 'hello@hotboxoffice.example',
		),
		'hotbox_hours_wk'   => array(
			'label'   => __( 'Hours: Monday – Friday', 'hotbox-office' ),
			'default' => '10:00 – 19:00',
		),
		'hotbox_hours_sat'  => array(
			'label'   => __( 'Hours: Saturday', 'hotbox-office' ),
			'default' => '10:00 – 18:00',
		),
		'hotbox_hours_sun'  => array(
			'label'   => __( 'Hours: Sunday', 'hotbox-office' ),
			'default' => '12:00 – 17:00',
		),
		'hotbox_disclaimer' => array(
			'label'   => __( 'Footer Disclaimer', 'hotbox-office' ),
			'default' => __( 'All products sold by Hotbox Office are psilocybin-free and legal for sale in Canada. Statements on this site have not been evaluated by Health Canada. Our products are not intended to diagnose, treat, cure, or prevent any disease. Consult a healthcare practitioner before use if you are pregnant, nursing, taking medication, or have a medical condition.', 'hotbox-office' ),
		),
	);
}

/**
 * Get a store detail with its default fallback.
 *
 * @param string $key Setting key.
 * @return string
 */
function hotbox_office_get_option( $key ) {
	$defaults = hotbox_office_option_defaults();
	$default  = isset( $defaults[ $key ] ) ? $defaults[ $key ]['default'] : '';

	return get_theme_mod( $key, $default );
}

/* --------------------------------------------------------------------------
 * WooCommerce integration
 * ------------------------------------------------------------------------ */

if ( hotbox_office_is_wc_active() ) {

	// Replace WooCommerce content wrappers with the theme's own.
	remove_action( 'woocommerce_before_main_content', 'woocommerce_output_content_wrapper', 10 );
	remove_action( 'woocommerce_after_main_content', 'woocommerce_output_content_wrapper_end', 10 );
	remove_action( 'woocommerce_sidebar', 'woocommerce_get_sidebar', 10 );

	add_action(
		'woocommerce_before_main_content',
		function () {
			echo '<main id="primary" class="hb-main hb-main--woo"><div class="hb-wrap">';
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

	// Category chips above the shop loop.
	add_action(
		'woocommerce_before_shop_loop',
		function () {
			if ( is_shop() || is_product_taxonomy() ) {
				hotbox_office_category_chips();
			}
		},
		15
	);

	// Wrap the loop item text so cards can flex.
	add_action(
		'woocommerce_before_shop_loop_item_title',
		function () {
			echo '<div class="hb-product-body">';
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
	function hotbox_office_cart_fragment( $fragments ) {
		$count = WC()->cart ? WC()->cart->get_cart_contents_count() : 0;

		$fragments['span.hb-cart-count'] = '<span class="hb-cart-count">' . esc_html( number_format_i18n( $count ) ) . '</span>';

		return $fragments;
	}
	add_filter( 'woocommerce_add_to_cart_fragments', 'hotbox_office_cart_fragment' );
}

/**
 * Output product-category filter chips, pill style.
 */
function hotbox_office_category_chips() {
	$terms = get_terms(
		array(
			'taxonomy'   => 'product_cat',
			'hide_empty' => true,
		)
	);

	if ( is_wp_error( $terms ) || empty( $terms ) ) {
		return;
	}

	$current = is_product_taxonomy() ? get_queried_object_id() : 0;
	$shop    = get_permalink( wc_get_page_id( 'shop' ) );

	echo '<div class="hb-chips" role="group" aria-label="' . esc_attr__( 'Filter products by category', 'hotbox-office' ) . '">';
	echo '<a class="hb-chip' . ( $current ? '' : ' active' ) . '" href="' . esc_url( $shop ) . '">' . esc_html__( 'All', 'hotbox-office' ) . '</a>';

	foreach ( $terms as $term ) {
		if ( 'uncategorized' === $term->slug ) {
			continue;
		}
		$active = ( $term->term_id === $current ) ? ' active' : '';
		echo '<a class="hb-chip' . esc_attr( $active ) . '" href="' . esc_url( get_term_link( $term ) ) . '">' . esc_html( $term->name ) . '</a>';
	}

	echo '</div>';
}

/**
 * Output the header cart pill.
 */
function hotbox_office_header_cart() {
	if ( ! hotbox_office_is_wc_active() ) {
		return;
	}

	$count = WC()->cart ? WC()->cart->get_cart_contents_count() : 0;
	?>
	<a class="hb-cart-btn" href="<?php echo esc_url( wc_get_cart_url() ); ?>">
		<?php esc_html_e( 'Cart', 'hotbox-office' ); ?>
		<span class="hb-cart-count"><?php echo esc_html( number_format_i18n( $count ) ); ?></span>
	</a>
	<?php
}

/**
 * Output the Hotbox greenhouse logo mark (SVG defs are printed once in the header).
 */
function hotbox_office_logo_mark() {
	?>
	<svg viewBox="0 0 100 110" aria-hidden="true" focusable="false"><use href="#hb-mark"></use></svg>
	<?php
}

/**
 * Print the shared SVG defs used by the logo mark and hero panel.
 * Hooked into wp_body_open so <use href="#..."> works anywhere on the page.
 */
function hotbox_office_svg_defs() {
	?>
	<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
		<defs>
			<g id="shroom">
				<path d="M50 12 C26 12 10 30 10 44 C10 50 15 53 24 53 L76 53 C85 53 90 50 90 44 C90 30 74 12 50 12 Z"/>
				<rect x="40" y="53" width="20" height="34" rx="9"/>
			</g>
			<linearGradient id="hb-green" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stop-color="#A9CB6F"/>
				<stop offset="1" stop-color="#5F8F3B"/>
			</linearGradient>
			<linearGradient id="hb-champagne" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="#F4EBD7"/>
				<stop offset="1" stop-color="#C6B384"/>
			</linearGradient>
			<path id="hb-leaflet" d="M0 0 C5 -8 6 -20 0 -34 C-6 -20 -5 -8 0 0 Z"/>
			<g id="hb-leaf">
				<use href="#hb-leaflet" transform="scale(1.15)"/>
				<use href="#hb-leaflet" transform="rotate(32) scale(.95)"/>
				<use href="#hb-leaflet" transform="rotate(-32) scale(.95)"/>
				<use href="#hb-leaflet" transform="rotate(68) scale(.72)"/>
				<use href="#hb-leaflet" transform="rotate(-68) scale(.72)"/>
				<use href="#hb-leaflet" transform="rotate(102) scale(.48)"/>
				<use href="#hb-leaflet" transform="rotate(-102) scale(.48)"/>
				<rect x="-1.1" y="-2" width="2.2" height="11" rx="1.1"/>
			</g>
			<g id="hb-mark">
				<path d="M52 16 C45 12 56 7 49 1" fill="none" stroke="var(--hb-mark-detail, #EDE6D3)" stroke-width="3" stroke-linecap="round"/>
				<path d="M50 22 L86 46 L86 100 Q86 104 82 104 L18 104 Q14 104 14 100 L14 46 Z" fill="none" stroke="url(#hb-green)" stroke-width="4" stroke-linejoin="round"/>
				<path d="M50 22 L50 104" fill="none" stroke="url(#hb-green)" stroke-width="3"/>
				<use href="#hb-leaf" transform="translate(32,88) scale(.92)" fill="url(#hb-green)"/>
				<use href="#shroom" transform="translate(55,53) scale(.34)" fill="var(--hb-mark-detail, #EDE6D3)"/>
				<use href="#shroom" transform="translate(66,80) scale(.17)" fill="var(--hb-mark-detail, #EDE6D3)"/>
			</g>
		</defs>
	</svg>
	<?php
}
add_action( 'wp_body_open', 'hotbox_office_svg_defs', 5 );

/**
 * Fallback menu when no primary menu is assigned.
 */
function hotbox_office_fallback_menu() {
	echo '<ul>';
	echo '<li><a href="' . esc_url( home_url( '/' ) ) . '">' . esc_html__( 'Home', 'hotbox-office' ) . '</a></li>';

	if ( hotbox_office_is_wc_active() ) {
		$shop_id = wc_get_page_id( 'shop' );
		if ( $shop_id > 0 ) {
			echo '<li><a href="' . esc_url( get_permalink( $shop_id ) ) . '">' . esc_html__( 'Shop', 'hotbox-office' ) . '</a></li>';
		}
	}

	echo '</ul>';
}
