import { DesktopSignIn } from "../web/DesktopSignIn";
import "../app/app.css";
import "../web/web.css";
import { mount } from "./mount";

mount(<DesktopSignIn search={location.search} />);
