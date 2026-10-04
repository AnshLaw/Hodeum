// First, so component styles of equal specificity win in dev as they do in release builds.
import "../components/shared/base.css";
import { DesktopSignIn } from "../web/DesktopSignIn";
import "../app/app.css";
import "../web/web.css";
import { mount } from "./mount";

mount(<DesktopSignIn search={location.search} />);
